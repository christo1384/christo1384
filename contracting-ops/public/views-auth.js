// Sign-in, first-run setup, and the account menu.
import { api, get, esc, card, openForm, toast, state } from './ui.js';

export async function signInView() {
  const { needs_setup: needsSetup } = await get('/api/auth/status');

  document.getElementById('view').innerHTML = `
    <div class="signin">
      <img class="signin-mark" src="/icon-180.png" alt="">
      <h1>${needsSetup ? 'Set up Contracting Ops' : 'Sign in'}</h1>
      <p class="muted">${needsSetup
        ? 'Nobody has an account yet. Create the first one — this page closes for good once you do.'
        : 'This system runs on your home network.'}</p>
      ${card('', `
        <div class="field"><label for="username">Username</label>
          <input id="username" autocomplete="username" autocapitalize="none" autocorrect="off"></div>
        ${needsSetup ? `<div class="field"><label for="display-name">Your name</label>
          <input id="display-name" autocomplete="name"></div>` : ''}
        <div class="field"><label for="password">Password</label>
          <input id="password" type="password"
                 autocomplete="${needsSetup ? 'new-password' : 'current-password'}"></div>
        ${needsSetup ? '<p class="meta">At least 10 characters. A phrase you will remember beats something clever.</p>' : ''}
        <p class="form-error" id="signin-error" hidden></p>
        <button class="btn btn-primary" id="signin-btn" style="width:100%;margin-top:8px" type="button">
          ${needsSetup ? 'Create account' : 'Sign in'}</button>
      `)}
    </div>`;

  const error = document.getElementById('signin-error');
  const submit = async () => {
    const payload = {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
    };
    if (needsSetup) payload.display_name = document.getElementById('display-name').value.trim();

    try {
      state.user = await api('POST', needsSetup ? '/api/auth/setup' : '/api/auth/login', payload);
      window.dispatchEvent(new Event('app:signed-in'));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };

  document.getElementById('signin-btn').addEventListener('click', submit);
  document.querySelectorAll('.signin input').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
  document.getElementById('username').focus();
}

export async function accountMenu() {
  const users = await get('/api/users').catch(() => []);
  const form = await openForm({
    title: `Signed in as ${state.user?.display_name ?? ''}`,
    submitLabel: 'Done',
    fields: [{
      name: 'action',
      label: 'Account',
      type: 'select',
      value: 'nothing',
      options: [
        { value: 'nothing', label: 'Close this menu' },
        { value: 'add_user', label: `Add another person (${users.length} account${users.length === 1 ? '' : 's'})` },
        { value: 'sign_out', label: 'Sign out' },
      ],
    }],
  });
  if (!form || form.action === 'nothing') return;

  if (form.action === 'sign_out') {
    await api('POST', '/api/auth/logout');
    state.user = null;
    window.dispatchEvent(new Event('app:signed-out'));
    return;
  }

  const newUser = await openForm({
    title: 'Add a person',
    submitLabel: 'Create account',
    fields: [
      { name: 'username', label: 'Username', required: true },
      { name: 'display_name', label: 'Their name', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true,
        hint: 'At least 10 characters. They can keep it or you can change it later from the box.' },
    ],
  });
  if (!newUser) return;
  try {
    const created = await api('POST', '/api/users', newUser);
    toast(`${esc(created.display_name)} can now sign in`);
  } catch (err) {
    toast(err.message);
  }
}
