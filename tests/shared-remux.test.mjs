import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedRemuxHub } from 'stream-core';

function fakeOpenRemux() {
  let opens = 0;
  const openRemux = (options) => {
    opens += 1;
    let controller;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel() {
        controller = null;
      },
    });
    stream.diagnostics = () => 'fake';
    stream._push = (bytes) => controller?.enqueue(bytes);
    stream._close = () => { controller?.close(); controller = null; };
    stream._error = (error) => { controller?.error(error); controller = null; };
    stream._opens = () => opens;
    stream._options = options;
    openRemux.last = stream;
    fakeOpenRemux.last = stream;
    return stream;
  };
  openRemux.opens = () => opens;
  return openRemux;
}

test('two viewers of the same source share one upstream remux', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 50 });

  const a = hub.subscribe({
    inputArgs: ['-i', 'rtsp://cam/1'],
    sourceUrl: 'rtsp://cam/1',
  });
  const b = hub.subscribe({
    inputArgs: ['-i', 'rtsp://cam/1'],
    sourceUrl: 'rtsp://cam/1',
  });

  assert.equal(openRemux.opens(), 1);
  assert.equal(hub.stats().sources, 1);
  assert.equal(hub.stats().viewers, 2);

  const ra = a.getReader();
  const rb = b.getReader();
  fakeOpenRemux.last._push(new Uint8Array([1, 2, 3]));

  const chunkA = await ra.read();
  const chunkB = await rb.read();
  assert.deepEqual([...chunkA.value], [1, 2, 3]);
  assert.deepEqual([...chunkB.value], [1, 2, 3]);

  await ra.cancel();
  await rb.cancel();
});

test('different source URLs open separate remuxes', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 50 });

  hub.subscribe({ inputArgs: ['-i', 'a'], sourceUrl: 'rtsp://a' });
  hub.subscribe({ inputArgs: ['-i', 'b'], sourceUrl: 'rtsp://b' });

  assert.equal(openRemux.opens(), 2);
  assert.equal(hub.stats().sources, 2);
});

test('late joiner receives bootstrap bytes from the shared pipe', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 50, bootstrapBytes: 1024 });

  const first = hub.subscribe({
    inputArgs: ['-i', 'rtsp://cam/1'],
    sourceUrl: 'rtsp://cam/1',
  });
  const r1 = first.getReader();
  // Drain start so the viewer is attached before we push.
  fakeOpenRemux.last._push(new Uint8Array([9, 9, 9]));
  await r1.read();

  const second = hub.subscribe({
    inputArgs: ['-i', 'rtsp://cam/1'],
    sourceUrl: 'rtsp://cam/1',
  });
  assert.equal(openRemux.opens(), 1);

  const r2 = second.getReader();
  const boot = await r2.read();
  assert.deepEqual([...boot.value], [9, 9, 9]);

  await r1.cancel();
  await r2.cancel();
});

test('source stops after the last viewer leaves and idle expires', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 30 });

  const stream = hub.subscribe({
    inputArgs: ['-i', 'rtsp://cam/1'],
    sourceUrl: 'rtsp://cam/1',
  });
  assert.equal(hub._size(), 1);
  await stream.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(hub._size(), 0);
});

test('maxSources rejects a new unique camera when full', () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, maxSources: 1, idleStopMs: 50 });
  hub.subscribe({ inputArgs: ['-i', 'a'], sourceUrl: 'rtsp://a' });
  assert.throws(
    () => hub.subscribe({ inputArgs: ['-i', 'b'], sourceUrl: 'rtsp://b' }),
    (error) => error.status === 429,
  );
});

test('live bytes do not extend the idle deadline after the last viewer leaves', async (t) => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 25 });
  const stream = hub.subscribe({ inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' });
  await stream.cancel();

  const interval = setInterval(() => openRemux.last._push(new Uint8Array([1])), 2);
  t.after(() => clearInterval(interval));
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(hub.stats().sources, 0);
});

test('a viewer returning during the grace period keeps the existing publisher', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, idleStopMs: 20 });
  const options = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  await hub.subscribe(options).cancel();
  const next = hub.subscribe(options);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(openRemux.opens(), 1);
  assert.equal(hub.stats().sources, 1);
  assert.equal(hub.stats().viewers, 1);
  await next.cancel();
});

test('a stalled viewer is disconnected without interrupting a healthy viewer', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, maxViewerQueueBytes: 8, bootstrapBytes: 0 });
  const source = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  const slowChanges = [];
  const slow = hub.subscribe({ ...source, onViewerChange: (delta) => slowChanges.push(delta) });
  const fast = hub.subscribe(source).getReader();

  for (let i = 0; i < 3; i += 1) {
    const chunk = new Uint8Array([i, i, i, i]);
    openRemux.last._push(chunk);
    assert.deepEqual((await fast.read()).value, chunk);
  }

  await assert.rejects(slow.getReader().read(), /too slow/);
  assert.equal(openRemux.opens(), 1);
  assert.equal(hub.stats().viewers, 1);
  assert.deepEqual(slowChanges, [1, -1]);
  await fast.cancel();
});

test('publisher completion detaches each viewer exactly once', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux });
  const abort = new AbortController();
  const changes = [];
  const source = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  const a = hub.subscribe({ ...source, signal: abort.signal, onViewerChange: (delta) => changes.push(delta) });
  const b = hub.subscribe({ ...source, onViewerChange: (delta) => changes.push(delta) });
  const ra = a.getReader();
  const rb = b.getReader();
  openRemux.last._close();
  assert.equal((await ra.read()).done, true);
  assert.equal((await rb.read()).done, true);
  abort.abort();
  await ra.cancel();
  assert.deepEqual(changes, [1, 1, -1, -1]);
  assert.deepEqual(hub.stats(), { sources: 0, viewers: 0, sourceList: [] });

  const replacement = hub.subscribe(source);
  assert.equal(openRemux.opens(), 2);
  await replacement.cancel();
});

test('publisher failure propagates to all viewers and releases accounting', async (t) => {
  t.mock.method(console, 'error', () => {});
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux });
  const abort = new AbortController();
  const changes = [];
  const source = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  const a = hub.subscribe({ ...source, signal: abort.signal, onViewerChange: (delta) => changes.push(delta) });
  const b = hub.subscribe({ ...source, onViewerChange: (delta) => changes.push(delta) });
  const ra = a.getReader();
  const rb = b.getReader();
  openRemux.last._error(new Error('Camera went offline'));
  await Promise.all([
    assert.rejects(ra.read(), /Camera went offline/),
    assert.rejects(rb.read(), /Camera went offline/),
  ]);
  abort.abort();
  assert.deepEqual(changes, [1, 1, -1, -1]);
  assert.equal(hub.stats().sources, 0);
  assert.equal(hub.stats().viewers, 0);
});

test('bootstrap keeps at most the configured bytes from an oversized chunk', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, bootstrapBytes: 4 });
  const source = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  const first = hub.subscribe(source).getReader();
  openRemux.last._push(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  await first.read();

  const next = hub.subscribe(source).getReader();
  const bootstrap = (await next.read()).value;
  assert.deepEqual([...bootstrap], [4, 5, 6, 7]);
  assert.equal(bootstrap.buffer.byteLength, 4);
  await first.cancel();
  await next.cancel();
});

test('bootstrap is bounded by the viewer queue and preserves the newest bytes', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux, bootstrapBytes: 100, maxViewerQueueBytes: 4 });
  const source = { inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' };
  const first = hub.subscribe(source).getReader();
  for (const bytes of [[1, 2, 3], [4, 5, 6]]) {
    openRemux.last._push(new Uint8Array(bytes));
    await first.read();
  }

  const next = hub.subscribe(source).getReader();
  const head = (await next.read()).value;
  const tail = (await next.read()).value;
  assert.deepEqual([...head, ...tail], [3, 4, 5, 6]);
  assert.equal(hub.stats().viewers, 2);
  await first.cancel();
  await next.cancel();
});

test('an already-aborted subscriber does not open a publisher or count as a viewer', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux });
  const changes = [];
  const abort = new AbortController();
  abort.abort();
  const stream = hub.subscribe({
    inputArgs: ['-i', 'live'],
    sourceUrl: 'rtsp://live',
    signal: abort.signal,
    onViewerChange: (delta) => changes.push(delta),
  });
  assert.equal((await stream.getReader().read()).done, true);
  assert.equal(openRemux.opens(), 0);
  assert.deepEqual(changes, []);
});

test('effective input arguments distinguish publishers even for the same URL', async () => {
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux });
  const a = hub.subscribe({ inputArgs: ['-rtsp_transport', 'tcp', '-i', 'rtsp://live'], sourceUrl: 'rtsp://live' });
  const b = hub.subscribe({ inputArgs: ['-rtsp_transport', 'udp', '-i', 'rtsp://live'], sourceUrl: 'rtsp://live' });
  assert.equal(openRemux.opens(), 2);
  await a.cancel();
  await b.cancel();
});

test('publisher has an independent configurable inactivity watchdog', async () => {
  for (const timeout of [undefined, 5000, 0]) {
    const openRemux = fakeOpenRemux();
    const hub = createSharedRemuxHub({ openRemux, sourceTimeoutMs: timeout, idleStopMs: 10 });
    const stream = hub.subscribe({ inputArgs: ['-i', 'live'], sourceUrl: 'rtsp://live' });
    assert.equal(openRemux.last._options.idleMs, timeout ?? 30_000);
    await stream.cancel();
  }
});

test('publisher error logging and source stats do not expose camera credentials', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const openRemux = fakeOpenRemux();
  const hub = createSharedRemuxHub({ openRemux });
  const sourceUrl = 'rtsp://operator:camera-secret@camera/live?token=private-token';
  const stream = hub.subscribe({ inputArgs: ['-i', sourceUrl], sourceUrl });
  const stats = JSON.stringify(hub.stats());
  assert.doesNotMatch(stats, /operator|camera-secret|private-token/);

  openRemux.last._error(new Error(`Failed ${sourceUrl}: camera-secret`));
  await assert.rejects(stream.getReader().read());
  assert.equal(log.mock.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(log.mock.calls[0].arguments), /operator|camera-secret|private-token/);
});
