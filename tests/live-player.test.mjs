import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveStreamPlayer, createRemuxSession } from '../packages/hevc-player/dist/index.js';

async function waitFor(check) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Live player did not reach the expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function environment(t, fetch) {
  const instances = [];
  class Player {
    constructor() { this.events = {}; this.destroyed = 0; this.volumes = []; instances.push(this); }
    on(event, callback) { this.events[event] = callback; }
    emit(event) { this.events[event]?.(); }
    async load(url) { this.url = url; }
    async play() { this.emit('firstVideoRendered'); }
    async destroy() { this.destroyed++; this.emit('ended'); }
    setVolume(value) { this.volumes.push(value); }
    async resume() {}
    isSuspended() { return false; }
    getStats() { return { width: 1920, height: 1080, videoFrameDecodeCount: 30n }; }
  }
  for (const [key, value] of Object.entries({ window: { AVPlayer: Player }, document: { baseURI: 'http://localhost/' }, fetch })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  return instances;
}

test('public live player renews session tickets and restores volume/mute after interruption', async (t) => {
  const requests = [];
  const instances = environment(t, async (url, options) => {
    requests.push({ url, options });
    return Response.json({ streamUrl: `/stream?ticket=${requests.length}` }, { status: 201 });
  });
  const statuses = [];
  let playing = 0;
  const player = startLiveStreamPlayer({}, {
    wasmBaseUrl: '/wasm/',
    resolveUrl: signal => createRemuxSession('rtsp://camera/live', { signal }),
    onStatus: status => statuses.push(status),
    onPlaying: () => playing++,
  });
  t.after(() => player.destroy());
  await waitFor(() => player.stats().frames === 30);
  player.setVolume(0.4);
  await player.setMuted(false);
  instances[0].emit('ended');
  instances[0].emit('error');
  instances[0].emit('timeout');
  await waitFor(() => playing === 2 && player.stats().frames === 30);
  assert.equal(requests.length, 2);
  assert.equal(instances[0].url, 'http://localhost/stream?ticket=1');
  assert.equal(instances[1].url, 'http://localhost/stream?ticket=2');
  assert.equal(instances[0].destroyed, 1);
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(player.getVolume(), 0.4);
  assert.equal(player.isMuted(), false);
  assert.equal(instances[1].volumes.at(-1), 0.4);
  assert.ok(statuses.includes('Reconnecting'));
  await player.destroy();
  const count = statuses.length;
  instances[1].emit('ended');
  instances[1].emit('firstVideoRendered');
  assert.equal(statuses.length, count);
  assert.equal(instances[1].destroyed, 1);
});

test('Stop aborts session registration before a decoder is created', async (t) => {
  let signal;
  const instances = environment(t, async (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const player = startLiveStreamPlayer({}, {
    wasmBaseUrl: '/wasm/',
    resolveUrl: signal => createRemuxSession('rtsp://camera/live', { signal }),
  });
  await waitFor(() => signal);
  await player.destroy();
  assert.equal(signal.aborted, true);
  assert.equal(instances.length, 0);
});

test('invalid source registration reports a terminal error without retry', async (t) => {
  environment(t, async () => Response.json({ error: 'Invalid source.' }, { status: 400 }));
  const messages = [];
  const statuses = [];
  const player = startLiveStreamPlayer({}, {
    wasmBaseUrl: '/wasm/',
    resolveUrl: signal => createRemuxSession('bad', { signal }),
    onError: message => messages.push(message),
    onStatus: status => statuses.push(status),
  });
  await waitFor(() => statuses.includes('Error'));
  assert.deepEqual(messages, ['Invalid source.']);
  await player.destroy();
});
