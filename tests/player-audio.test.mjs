import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStreamPlayer } from '../packages/hevc-player/dist/create-player.js';

function fakePlayer(t, { suspended = false } = {}) {
  let inner;
  class Player {
    constructor(options) { this.options = options; this.volumes = []; this.resumes = 0; this.suspended = suspended; inner = this; }
    on() {}
    async load(url) { this.url = url; }
    async play(options) { this.playOptions = options; }
    async destroy() { this.destroyed = true; }
    setVolume(value) { this.volumes.push(value); }
    async resume() { this.resumes += 1; }
    isSuspended() { return this.suspended; }
  }
  for (const [key, value] of Object.entries({ window: { AVPlayer: Player }, document: { baseURI: 'http://localhost/' } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  return () => inner;
}

test('audio is enabled but starts muted; changing volume does not restart or unmute', async (t) => {
  const getInner = fakePlayer(t);
  const player = await createStreamPlayer({}, { url: '/stream' });
  const inner = getInner();
  assert.deepEqual(inner.playOptions, { audio: true, video: true });
  assert.equal(inner.volumes.at(-1), 0);
  assert.equal(player.isMuted(), true);
  player.setVolume(0.4);
  assert.equal(inner.volumes.at(-1), 0);
  await player.setMuted(false);
  assert.equal(inner.resumes, 1);
  assert.equal(inner.volumes.at(-1), 0.4);
  assert.equal(player.getVolume(), 0.4);
  await player.setMuted(true);
  assert.equal(inner.volumes.at(-1), 0);
  await player.destroy();
  assert.equal(inner.destroyed, true);
});

test('player supplies AAC, resampling and timing assets from the configured base', async (t) => {
  const getInner = fakePlayer(t);
  await createStreamPlayer({}, { url: '/stream', wasmBaseUrl: '/assets/audio', wasmUrl: '/legacy-hevc.wasm' });
  const getWasm = getInner().options.getWasm;
  assert.equal(getWasm('decoder', 86018), '/assets/audio/aac-simd.wasm');
  assert.equal(getWasm('resampler'), '/assets/audio/resample-simd.wasm');
  assert.equal(getWasm('stretchpitcher'), '/assets/audio/stretchpitch-simd.wasm');
  assert.equal(getWasm('decoder', 173), '/legacy-hevc.wasm');
  assert.throws(() => getWasm('decoder', 123456), /convert camera audio to AAC/);
});

test('blocked audio activation stays muted and reports the required gesture', async (t) => {
  const getInner = fakePlayer(t, { suspended: true });
  const player = await createStreamPlayer({}, { url: '/stream' });
  await assert.rejects(player.setMuted(false), /click or tap/);
  assert.equal(player.isMuted(), true);
  assert.equal(getInner().volumes.at(-1), 0);
});

test('video-only opt-out and volume validation remain explicit', async (t) => {
  const getInner = fakePlayer(t);
  const player = await createStreamPlayer({}, { url: '/stream', audio: false });
  assert.equal(getInner().playOptions.audio, false);
  await assert.rejects(player.setMuted(false), /Audio is disabled/);
  for (const volume of [-1, 2, NaN, Infinity]) assert.throws(() => player.setVolume(volume), /Volume/);
});

test('audio activation allows asynchronous device startup and respects a later mute', async (t) => {
  const getInner = fakePlayer(t, { suspended: true });
  const player = await createStreamPlayer({}, { url: '/stream' });
  const timer = setTimeout(() => { getInner().suspended = false; }, 150);
  t.after(() => clearTimeout(timer));
  await player.setMuted(false);
  assert.equal(player.isMuted(), false);
  getInner().suspended = true;
  const pending = player.setMuted(false);
  await player.setMuted(true);
  await pending;
  assert.equal(player.isMuted(), true);
  assert.equal(getInner().volumes.at(-1), 0);
});

test('packaged audio WASM assets are valid modules', async () => {
  for (const name of ['aac', 'resample', 'stretchpitch']) {
    const bytes = await readFile(new URL(`../packages/hevc-player/wasm/${name}-simd.wasm`, import.meta.url));
    assert.equal(WebAssembly.validate(bytes), true, name);
  }
});
