import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamToFile } from './http.ts';

test('oversize streamed bodies return 413 without destroying the request socket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podstudio-limit-'));
  try {
    const req = new Readable({ read() {} }) as IncomingMessage;
    req.headers = { 'content-length': '200' };
    await assert.rejects(streamToFile(req, join(dir, 'file'), 100), { status: 413 });
    assert.equal(req.destroyed, false, 'HTTP handler can still send a response');
    req.destroy();
    const chunked = new Readable({ read() { this.push(Buffer.alloc(101)); this.push(null); } }) as IncomingMessage;
    chunked.headers = {};
    await assert.rejects(streamToFile(chunked, join(dir, 'chunked'), 100), { status: 413 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
