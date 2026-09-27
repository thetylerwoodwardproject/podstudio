// Where the browser tests find things: the test server, Chromium, the fixtures and
// helper scripts, and a scratch folder for downloads and screenshots (.out, not in git).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const B = process.env.PS_BASE ?? 'https://localhost:4400';
export const OUT = process.env.PS_OUT ?? join(HERE, '.out');
/** The test server's data folder (run.mjs starts it there) */
export const DATA = process.env.PS_DATA ?? join(OUT, 'data');
export const FIX = join(HERE, 'fixtures');
export const TOOLS = join(HERE, 'tools');
export const CHROME = process.env.PS_CHROME ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

for (const d of ['flow', 'publish', 'tones', 'pads', 'ns', 'dl-solo', 'shots/rec', 'uploads', 'guest']) mkdirSync(join(OUT, d), { recursive: true });
// The voice with a steady hiss under it, made from voice-like.wav (seeded, so always the same)
if (!existsSync(join(OUT, 'voice-noisy.wav'))) execFileSync('python3', [join(TOOLS, 'noisy.py'), join(FIX, 'voice-like.wav'), join(OUT, 'voice-noisy.wav')]);
