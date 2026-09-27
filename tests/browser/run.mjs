// npm run test:browser [-- name …]: starts the built server with empty data on :4400
// (https, self-signed), runs each browser test in turn, and stops it. Build first
// (npm run build) so the server serves the code you're testing. Logs, downloads and
// screenshots go to tests/browser/.out.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, DATA, OUT } from './env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
// Quick ones first; the guest tests run two browsers for a few minutes each.
const ORDER = ['import', 'mic', 'saved', 'flow', 'publish', 'tones', 'pads', 'ns', 'ns-player', 'solo', 'uploads', 'guest', 'guest-sync'];
const all = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).map((f) => f.slice(0, -9));
const names = process.argv.slice(2).length ? process.argv.slice(2) : [...ORDER.filter((n) => all.includes(n)), ...all.filter((n) => !ORDER.includes(n))];
for (const n of names) if (!all.includes(n)) throw new Error(`No test called ${n} (there are: ${all.join(', ')})`);
if (!existsSync(join(ROOT, 'dist'))) throw new Error('No build: run npm run build first');

rmSync(DATA, { recursive: true, force: true });
rmSync(join(OUT, 'auth-state.json'), { force: true });
mkdirSync(join(OUT, 'logs'), { recursive: true });
const url = new URL(B);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.ts', '--https', '--host', url.hostname, '--port', url.port || '443'], {
  cwd: ROOT,
  env: { ...process.env, PODSTUDIO_DATA: DATA },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stop = () => server.exitCode === null && server.kill();
process.on('exit', stop);

for (let i = 0; ; i++) {
  if (server.exitCode !== null || i > 100) throw new Error(`The test server didn't start:\n${serverLog}`);
  try {
    if ((await fetch(`${B}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const results = [];
for (const name of names) {
  const started = Date.now();
  process.stdout.write(`${name} … `);
  const child = spawn(process.execPath, ['--no-warnings', join(HERE, `${name}.test.mjs`)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  writeFileSync(join(OUT, 'logs', `${name}.log`), out);
  const passed = code === 0 && /ALL PASS/.test(out);
  results.push({ name, passed });
  console.log(`${passed ? 'pass' : 'FAIL'} (${Math.round((Date.now() - started) / 1000)} s)`);
  if (!passed) {
    const lines = out.split('\n').filter((l) => /^FAIL|Error|FAILED/.test(l));
    console.log((lines.length ? lines : out.split('\n').slice(-15)).map((l) => `    ${l}`).join('\n'));
  }
}
writeFileSync(join(OUT, 'logs', 'server.log'), serverLog);
stop();
const failed = results.filter((r) => !r.passed);
console.log(failed.length ? `\n${failed.length} of ${results.length} failed: ${failed.map((r) => r.name).join(', ')} (logs in tests/browser/.out/logs)` : `\nAll ${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
