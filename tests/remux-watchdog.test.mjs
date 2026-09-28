import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';
import { createMpegTsRemux } from '../packages/stream-core/src/remux.mjs';

// Exercise the actual Next handler without starting a development server.
const routeUrl = new URL('../app/api/stream/route.ts', import.meta.url);
await loadBindings();
const { code } = await transform(await readFile(routeUrl, 'utf8'), {
  filename: 'route.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'es6' },
});
const routeSource = code.replace(/from ['"]([.][^'"]+)['"]/g, (_, specifier) => `from '${new URL(specifier, routeUrl).href}'`);
const { GET } = await import(`data:text/javascript;base64,${Buffer.from(routeSource).toString('base64')}`);

function mockFfmpeg(t) {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.signals = [];
  process.kill = (signal) => { process.signals.push(signal); return true; };
  t.mock.method(childProcess, 'spawn', () => process);
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return process;
}

const implementations = [
  ['shared remux', () => createMpegTsRemux({ inputArgs: ['-i', 'test'] })],
  ['Next stream route', async () => {
    const response = await GET(new Request('http://localhost/api/stream?source=demo'));
    assert.equal(response.status, 200);
    return response.body;
  }],
];

for (const [name, open] of implementations) {
  test(`${name}: a slow reader does not trip the camera inactivity watchdog`, async (t) => {
    const ffmpeg = mockFfmpeg(t);
    const stream = await open();
    const reader = stream.getReader();
    ffmpeg.stdout.write(Buffer.alloc(2 * 1024 * 1024, 7));
    assert.equal(ffmpeg.stdout.isPaused(), true);

    t.mock.timers.tick(60_000);
    assert.deepEqual(ffmpeg.signals, [], 'FFmpeg stays alive while its output is deliberately paused');
    assert.equal((await reader.read()).value.byteLength, 2 * 1024 * 1024);
    assert.equal(ffmpeg.stdout.isPaused(), false);

    const next = reader.read();
    ffmpeg.stdout.write(Buffer.from([1, 2, 3]));
    assert.deepEqual([...(await next).value], [1, 2, 3]);
    await reader.cancel();
    assert.deepEqual(ffmpeg.signals, ['SIGTERM'], 'disconnect still cleans up the process');
  });

  test(`${name}: an offline camera still times out while a reader is waiting`, async (t) => {
    const ffmpeg = mockFfmpeg(t);
    const reader = (await open()).getReader();
    const rejected = assert.rejects(reader.read(), /Stream timed out/);
    t.mock.timers.tick(20_000);
    await rejected;
    assert.deepEqual(ffmpeg.signals, ['SIGTERM']);
  });

  test(`${name}: the camera watchdog resumes after backpressure clears`, async (t) => {
    const ffmpeg = mockFfmpeg(t);
    const reader = (await open()).getReader();
    ffmpeg.stdout.write(Buffer.alloc(2 * 1024 * 1024));
    t.mock.timers.tick(60_000);
    await reader.read();
    const rejected = assert.rejects(reader.read(), /Stream timed out/);
    t.mock.timers.tick(19_999);
    assert.deepEqual(ffmpeg.signals, []);
    t.mock.timers.tick(1);
    await rejected;
    assert.deepEqual(ffmpeg.signals, ['SIGTERM']);
  });
}
