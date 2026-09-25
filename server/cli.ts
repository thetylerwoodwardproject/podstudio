/*
 * For whoever runs the server, from its shell:
 *
 *   npm run reset-password -- <username>   set a new password (asks for it)
 *   npm run reset-2fa -- <username>        turn two-factor off, to set it up again at sign-in
 *
 * Both sign that account out everywhere.
 */
import { createInterface } from 'node:readline/promises';
import { passwordProblem, hashPassword } from './auth.ts';
import { loadConfig } from './config.ts';
import { dbFile, openDb } from './db.ts';

const [command, username] = process.argv.slice(2);
if (!command || !username) {
  console.error('Usage: node server/cli.ts reset-password|reset-2fa <username>');
  process.exit(2);
}
const db = openDb(dbFile(loadConfig().data));
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
if (!user) {
  console.error(`No account called ${username}.`);
  process.exit(1);
}

if (command === 'reset-password') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question('New password (at least 10 characters): ');
  rl.close();
  const problem = passwordProblem(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
} else if (command === 'reset-2fa') {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = -1 WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(user.id);
} else {
  console.error(`Unknown command ${command}`);
  process.exit(2);
}
db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
console.log(`Done. ${username} is signed out everywhere.`);
