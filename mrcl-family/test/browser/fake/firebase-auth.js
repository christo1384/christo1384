export function getAuth(app) {
  return { app };
}

export function onAuthStateChanged(auth, next) {
  // Mirrors the real SDK: fires asynchronously, returns an unsubscribe.
  queueMicrotask(() => next({ uid: 'test-uid', isAnonymous: true }));
  return () => {};
}

export async function signInAnonymously() {
  return { user: { uid: 'test-uid', isAnonymous: true } };
}
