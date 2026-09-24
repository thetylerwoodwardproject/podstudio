import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zip } from './zip.ts';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('archive unzips with the system unzip', async () => {
  const blob = await zip([
    { name: 'takes.csv', data: 'take,start\nTake 1,00:00:00\n' },
    { name: 'audio/Ep142_Take1.wav', data: new Blob([new Uint8Array(1000).fill(7)]) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  execFileSync('unzip', ['-q', '-t', file]);
  execFileSync('unzip', ['-q', file, '-d', dir]);
  assert.equal(readFileSync(join(dir, 'takes.csv'), 'utf8'), 'take,start\nTake 1,00:00:00\n');
  assert.equal(readFileSync(join(dir, 'audio/Ep142_Take1.wav')).length, 1000);
});
