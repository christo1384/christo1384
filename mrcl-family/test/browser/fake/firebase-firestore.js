// Just enough Firestore to exercise the real render path in a browser: an
// in-memory collection, seeded from window.__TEST_ITEMS__, with live listeners.

const listeners = new Set();
let docs = [];
let nextId = 1;

function seed() {
  docs = (globalThis.__TEST_ITEMS__ || []).map((item, index) => ({
    id: item.id || `seed-${index}`,
    data: { who: '', time: '', annual: false, done: false, ...item },
  }));
  nextId = docs.length + 1;
}
seed();

globalThis.__TEST_STORE__ = {
  all: () => docs.map((d) => ({ id: d.id, ...d.data })),
  reseed: () => {
    seed();
    notify();
  },
};

function matches(doc, clauses) {
  return clauses.every(({ field, op, value }) => {
    const actual = doc.data[field];
    if (op === '==') return actual === value;
    if (op === '>=') return actual >= value;
    if (op === '<=') return actual <= value;
    return true;
  });
}

function notify() {
  for (const listener of listeners) listener();
}

export function getFirestore(app) {
  return { app };
}

export function collection(db, path) {
  return { path };
}

export function doc(db, path, id) {
  return { path, id };
}

export function where(field, op, value) {
  return { field, op, value };
}

export function query(ref, ...clauses) {
  return { ref, clauses };
}

export function serverTimestamp() {
  return { __server: true };
}

export function onSnapshot(q, next) {
  const emit = () => {
    const selected = docs.filter((d) => matches(d, q.clauses));
    next({ docs: selected.map((d) => ({ id: d.id, data: () => ({ ...d.data }) })) });
  };
  listeners.add(emit);
  queueMicrotask(emit);
  return () => listeners.delete(emit);
}

export async function addDoc(ref, data) {
  const id = `added-${nextId}`;
  nextId += 1;
  docs.push({ id, data: { ...data } });
  notify();
  return { id };
}

export async function updateDoc(ref, patch) {
  const found = docs.find((d) => d.id === ref.id);
  if (!found) throw new Error('No such document');
  Object.assign(found.data, patch);
  notify();
}

export async function deleteDoc(ref) {
  docs = docs.filter((d) => d.id !== ref.id);
  notify();
}
