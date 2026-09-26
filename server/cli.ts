/*
 * For whoever runs the server, from its shell:
 *
 *   npm run reset-password -- <username>   set a new password (asks for it)
 *   npm run reset-2fa -- <username>        turn two-factor off, to set it up again at sign-in
 *
 * Both sign that account out everywhere.
 *
 *   npm run setup-link                     the one-time link to create the admin account
 */
import { createInterface } from 'node:readline/promises';
import { passwordProblem, hashPassword } from './auth.ts';
import { loadConfig } from './config.ts';
import { dbFile, openDb } from './db.ts';
import { setupLink, setupTokenRequired, tokenFile } from './setup-token.ts';
import { readFileSync } from 'node:fs';

const [command, username] = process.argv.slice(2);
const config = loadConfig();
if (command === 'setup-link') {
  const db = openDb(dbFile(config.data));
  const hasUser = !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (hasUser) console.log('This server already has an account: sign in instead.');
  else if (!setupTokenRequired(config.data)) console.log('No setup link yet: start the server (systemctl start podstudio) and try again.');
  else console.log(setupLink(config.origin, readFileSync(tokenFile(config.data), 'utf8').trim()));
  process.exit(0);
}
if (!command || !username) {
  console.error('Usage: node server/cli.ts reset-password|reset-2fa <username> | setup-link');
  process.exit(2);
}
const db = openDb(dbFile(config.data));
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
