#!/usr/bin/env node
// Account management from the box's terminal.
//   npm run user:add -- --username mike --name "Mike" [--password ...]
//   npm run user:passwd -- --username mike
//   npm run user:list
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createUser, hashPassword } from '../src/lib/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE ?? join(here, '..', 'data', 'ops.db');

const args = new Map();
for (let i = 3; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[i + 1]);
}

const command = process.argv[2];
const db = openDb(dbFile);

try {
  if (command === 'list') {
    const rows = db.prepare(
      'SELECT id, username, display_name, last_login_at FROM users ORDER BY username',
    ).all();
    if (!rows.length) console.log('No accounts yet. Run: npm run user:add -- --username <name>');
    for (const r of rows) {
      console.log(`${String(r.id).padStart(3)}  ${r.username.padEnd(20)} ${r.display_name.padEnd(24)} last login: ${r.last_login_at ?? 'never'}`);
    }
  } else if (command === 'add') {
    const username = args.get('username') ?? await ask('Username: ');
    const displayName = args.get('name') ?? await ask('Display name: ');
    const password = args.get('password') ?? await askHidden('Password (min 10 chars): ');
    const user = createUser(db, { username, displayName, password });
    console.log(`Created ${user.username} (#${user.id}).`);
  } else if (command === 'passwd') {
    const username = args.get('username') ?? await ask('Username: ');
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!row) throw new Error(`No account named ${username}`);
    const password = args.get('password') ?? await askHidden('New password (min 10 chars): ');
    if (password.length < 10) throw new Error('Password must be at least 10 characters');
    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);   // sign out everywhere
    console.log(`Password changed for ${username}. Existing sign-ins were ended.`);
  } else {
    console.log('Usage: user.js <add|passwd|list> [--username x] [--name "X"] [--password ...]');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}

function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); }));
}

/** Reads without echoing, so the password stays out of the terminal scrollback. */
function askHidden(prompt) {
  const ENTER = ['\r', '\n', ''];
  const CTRL_C = '';
  const BACKSPACE = '';

  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) { reject(new Error('Pass --password when there is no terminal')); return; }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let value = '';
    const onData = (chunk) => {
      const char = chunk.toString('utf8');
      if (ENTER.includes(char)) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === CTRL_C) {
        process.stdin.setRawMode(false);
        process.exit(1);
      } else if (char === BACKSPACE) {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
