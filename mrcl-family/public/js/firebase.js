// Firebase bootstrap.
//
// The SDK is imported dynamically, on purpose. A static import from the CDN
// would put gstatic.com in the module graph of every page, so a flaky
// connection or a blocked CDN would leave the kitchen TV showing a blank white
// screen with no explanation. Loading it inside connect() means the board
// always renders and says what is wrong instead.
//
// Anonymous sign-in happens automatically so the Firestore rules can require
// an authenticated caller without anyone in the house seeing a login screen.

import { CONFIG, isConfigured } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let ready = null;

async function bootstrap() {
  if (!isConfigured()) throw new Error('not-configured');

  let appModule;
  let authModule;
  let firestore;
  try {
    [appModule, authModule, firestore] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
  } catch {
    throw new Error('sdk-unreachable');
  }

  const app = appModule.initializeApp(CONFIG.firebase);
  const auth = authModule.getAuth(app);
  const db = firestore.getFirestore(app);

  const uid = await new Promise((resolve, reject) => {
    const stop = authModule.onAuthStateChanged(
      auth,
      (user) => {
        if (!user) return;
        stop();
        resolve(user.uid);
      },
      (error) => {
        stop();
        reject(error);
      },
    );
    authModule.signInAnonymously(auth).catch((error) => {
      stop();
      // The most common cause by far is Anonymous sign-in still being switched
      // off in the Firebase console, so name it rather than leaking a code.
      reject(new Error(error?.code === 'auth/operation-not-allowed' ? 'anonymous-auth-disabled' : 'sign-in-failed'));
    });
  });

  // The Firestore functions travel with the connection so nothing else in the
  // app needs to know the SDK lives on a CDN.
  return { app, auth, db, uid, api: firestore };
}

/** Resolves to { db, uid, api } once Firebase is up and signed in. */
export function connect() {
  if (ready) return ready;

  ready = bootstrap();

  // A failed connection must not be cached forever, or one flaky load would
  // leave the board broken until somebody power-cycled the TV.
  ready.catch(() => {
    ready = null;
  });

  return ready;
}

/** Test seam: drop the memoised connection. */
export function resetConnection() {
  ready = null;
}
