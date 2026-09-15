// Reading and writing the family list.
//
// The board listens rather than polls, so a phone tapping "Done" greys the
// item out on the kitchen TV within a second.

import { CONFIG } from './config.js';
import { connect } from './firebase.js';
import { normaliseItem, validateItem } from './item.js';

function itemsRef(api, db) {
  return api.collection(db, CONFIG.collection);
}

// Reasons connect() can fail that the views have a specific message for.
const CONNECT_ERRORS = new Set(['not-configured', 'sdk-unreachable', 'anonymous-auth-disabled', 'sign-in-failed']);

function toItem(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    title: data.title || '',
    category: data.category || 'note',
    who: data.who || '',
    date: data.date || '',
    time: data.time || '',
    annual: Boolean(data.annual),
    done: Boolean(data.done),
  };
}

/**
 * Watch every item that could appear in `days`: the ones dated inside the
 * week, plus the annual ones (birthdays), which carry a year that has nothing
 * to do with this week.
 *
 * Both are single-field queries, so Firestore needs no composite index.
 *
 * Returns an unsubscribe function. `onError` is called with a short reason
 * rather than a Firebase error object.
 */
export function subscribeToWeek(days, onChange, onError = () => {}) {
  const first = days[0].iso;
  const last = days[days.length - 1].iso;

  let dated = [];
  let annual = [];
  let stopped = false;
  const unsubscribers = [];

  const emit = () => {
    if (!stopped) onChange([...dated, ...annual]);
  };

  connect()
    .then(({ db, api }) => {
      if (stopped) return;

      unsubscribers.push(
        api.onSnapshot(
          api.query(itemsRef(api, db), api.where('date', '>=', first), api.where('date', '<=', last)),
          (snap) => {
            dated = snap.docs.map(toItem).filter((item) => !item.annual);
            emit();
          },
          (error) => onError(error?.code === 'permission-denied' ? 'permission-denied' : 'read-failed'),
        ),
      );

      unsubscribers.push(
        api.onSnapshot(
          api.query(itemsRef(api, db), api.where('annual', '==', true)),
          (snap) => {
            annual = snap.docs.map(toItem);
            emit();
          },
          (error) => onError(error?.code === 'permission-denied' ? 'permission-denied' : 'read-failed'),
        ),
      );
    })
    .catch((error) => onError(CONNECT_ERRORS.has(error?.message) ? error.message : 'connect-failed'));

  return () => {
    stopped = true;
    for (const stop of unsubscribers) stop();
  };
}

/** Add an item. Throws with the first validation message if it is not valid. */
export async function addItem(input) {
  const { ok, value, errors } = validateItem(input);
  if (!ok) throw new Error(errors[0].message);

  const { db, api } = await connect();
  const ref = await api.addDoc(itemsRef(api, db), {
    ...value,
    createdAt: api.serverTimestamp(),
    updatedAt: api.serverTimestamp(),
  });
  return ref.id;
}

/** Replace an item's editable fields. */
export async function updateItem(id, input) {
  const { ok, value, errors } = validateItem(input);
  if (!ok) throw new Error(errors[0].message);

  const { db, api } = await connect();
  await api.updateDoc(api.doc(db, CONFIG.collection, id), { ...value, updatedAt: api.serverTimestamp() });
}

/** Tick something off, or un-tick it. */
export async function setDone(id, done) {
  const { db, api } = await connect();
  await api.updateDoc(api.doc(db, CONFIG.collection, id), { done: Boolean(done), updatedAt: api.serverTimestamp() });
}

export async function deleteItem(id) {
  const { db, api } = await connect();
  await api.deleteDoc(api.doc(db, CONFIG.collection, id));
}

export { normaliseItem };
