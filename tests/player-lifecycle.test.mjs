import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createStreamPlayer } from '../packages/hevc-player/dist/create-player.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

function environment(t, { load, play, destroy } = {}) {
  const instances = [];
  const loading = deferred();
  const playing = deferred();
  class Player {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.destroyCalls = 0;
      this.playCalls = 0;
      this.sizes = [];
      instances.push(this);
    }
    on(event, callback) {
      this.events.set(event, [...(this.events.get(event) ?? []), callback]);
    }
    emit(event) { this.events.get(event)?.forEach((callback) => callback()); }
    async load() { loading.resolve(); await load; }
    async play() { this.playCalls++; playing.resolve(); await play; }
    async destroy() { this.destroyCalls++; this.emit('ended'); await destroy; }
    setVolume() {}
    async resume() {}
    isSuspended() { return false; }
    resize(width, height) { this.sizes.push([width, height]); }
  }
  setGlobal(t, 'window', { AVPlayer: Player });
  setGlobal(t, 'document', { baseURI: 'http://localhost/' });
  return { instances, loading: loading.promise, playing: playing.promise };
}

test('live playback keeps a balanced jitter buffer and software decoding', async (t) => {
  const { instances } = environment(t);
  const live = await createStreamPlayer({}, { url: '/stream' });
  assert.equal(instances[0].options.lowLatency, true);
  assert.equal(instances[0].options.enableJitterBuffer, true);
  assert.equal(instances[0].options.jitterBufferMin, 0.5);
  assert.equal(instances[0].options.jitterBufferMax, 2);
  assert.equal(instances[0].options.enableWebCodecs, false);
  assert.equal(instances[0].options.enableHardware, false);
  await live.destroy();
  const file = await createStreamPlayer({}, { url: '/file.mp4', live: false });
  assert.equal(instances[1].options.lowLatency, false);
  assert.equal(instances[1].options.jitterBufferMin, 0.2);
  assert.equal(instances[1].options.jitterBufferMax, 1);
  await file.destroy();
});

test('already cancelled startup never allocates a decoder', async (t) => {
  const { instances } = environment(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createStreamPlayer({}, { url: '/stream', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(instances.length, 0);
});

test('cancelling a pending load releases the player and ignores late completion/events', { timeout: 2000 }, async (t) => {
  const load = deferred();
  const { instances, loading } = environment(t, { load: load.promise });
  const controller = new AbortController();
  let events = 0;
  const started = createStreamPlayer({}, {
    url: '/stream', signal: controller.signal,
    onPlaying: () => events++, onError: () => events++, onEnded: () => events++, onTimeout: () => events++,
  });
  await loading;
  const rejected = assert.rejects(started, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(instances[0].destroyCalls, 1);
  load.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  for (const event of ['firstVideoRendered', 'error', 'ended', 'timeout']) instances[0].emit(event);
  assert.equal(instances[0].playCalls, 0);
  assert.equal(events, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('cancelling pending play does not wait for its completion', { timeout: 2000 }, async (t) => {
  const play = deferred();
  const { instances, playing } = environment(t, { play: play.promise });
  const controller = new AbortController();
  const started = createStreamPlayer({}, { url: '/stream', signal: controller.signal });
  await playing;
  const rejected = assert.rejects(started, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(instances[0].destroyCalls, 1);
  play.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instances[0].destroyCalls, 1);
});

test('cancelled startup waits for renderer teardown before allowing a replacement', { timeout: 2000 }, async (t) => {
  const load = deferred();
  const destroy = deferred();
  const { instances, loading } = environment(t, { load: load.promise, destroy: destroy.promise });
  const controller = new AbortController();
  let rejected = false;
  const started = createStreamPlayer({}, { url: '/stream', signal: controller.signal });
  const checked = assert.rejects(started, { name: 'AbortError' }).then(() => { rejected = true; });
  await loading;
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instances[0].destroyCalls, 1);
  assert.equal(rejected, false, 'container must stay reserved while the renderer is being removed');
  destroy.resolve();
  await checked;
  assert.equal(rejected, true);
  load.resolve();
});

test('resizing updates the rendering viewport and teardown is idempotent', async (t) => {
  const { instances } = environment(t);
  let observer;
  setGlobal(t, 'ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observer = this; }
    observe(container) { this.container = container; }
    disconnect() { this.disconnected = true; }
  });
  const container = { clientWidth: 640, clientHeight: 360 };
  const controller = new AbortController();
  let ended = 0;
  const player = await createStreamPlayer(container, { url: '/stream', signal: controller.signal });
  player.on('ended', () => ended++);
  assert.equal(observer.container, container);
  assert.deepEqual(instances[0].sizes, []);
  observer.callback();
  assert.deepEqual(instances[0].sizes, [], 'unchanged ResizeObserver notifications must not clear the canvas');
  container.clientWidth = 1280;
  container.clientHeight = 720;
  observer.callback();
  assert.deepEqual(instances[0].sizes.at(-1), [1280, 720]);
  container.clientWidth = 0;
  observer.callback();
  assert.equal(instances[0].sizes.length, 1, 'hidden containers must not zero the canvas');
  const first = player.destroy();
  const second = player.destroy();
  assert.equal(first, second);
  await first;
  controller.abort();
  container.clientWidth = 1920;
  observer.callback();
  assert.equal(observer.disconnected, true);
  assert.equal(instances[0].sizes.length, 1);
  assert.equal(instances[0].destroyCalls, 1);
  assert.equal(ended, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('aborting an already started player stops it exactly once', async (t) => {
  const { instances } = environment(t);
  const controller = new AbortController();
  const player = await createStreamPlayer({}, { url: '/stream', signal: controller.signal });
  controller.abort();
  await player.destroy();
  assert.equal(instances[0].destroyCalls, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
