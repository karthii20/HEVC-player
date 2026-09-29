import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameHold } from '../packages/hevc-player/dist/frame-hold.js';

function setup(t) {
  const callbacks = new Map();
  let nextFrame = 0;
  let copies = 0;
  const source = { width: 640, height: 360, pixels: 'last decoded picture' };
  const container = {
    style: { position: '' },
    children: [],
    querySelector: () => source,
    appendChild(child) { this.children.push(child); },
  };
  const globals = {
    requestAnimationFrame(callback) { const id = ++nextFrame; callbacks.set(id, callback); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    getComputedStyle: () => ({ position: container.style.position || 'static' }),
    document: {
      createElement() {
        const canvas = {
          style: {}, dataset: {}, setAttribute() {},
          remove() { container.children = container.children.filter(child => child !== canvas); },
          getContext: () => ({ drawImage(image) { copies++; canvas.pixels = image.pixels; } }),
        };
        return canvas;
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const hold = createFrameHold(container);
  t.after(() => hold.destroy());
  const paint = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback();
  };
  return { hold, container, source, paint, copies: () => copies };
}

test('holds the last picture through failures and removes it only after replacement paints', (t) => {
  const { hold, container, source, paint, copies } = setup(t);
  const first = hold.beginAttempt();
  first.rendered();
  assert.equal(copies(), 0, 'healthy playback must not copy every frame');
  first.freeze();
  const image = container.children[0];
  assert.equal(image.pixels, 'last decoded picture');
  assert.equal(image.width, 640);
  assert.equal(image.height, 360);
  source.pixels = 'blank startup canvas';
  hold.beginAttempt().freeze();
  assert.equal(container.children[0], image);
  assert.equal(copies(), 1, 'failed startup must never overwrite the held frame');
  const next = hold.beginAttempt();
  next.rendered();
  assert.equal(container.children[0], image);
  paint();
  assert.equal(container.children[0], image, 'wait for the browser to present the replacement');
  paint();
  assert.equal(container.children.length, 0);
});

test('an interruption before the replacement paint cancels release of the old picture', (t) => {
  const { hold, container, paint } = setup(t);
  const first = hold.beginAttempt();
  first.rendered();
  first.freeze();
  const next = hold.beginAttempt();
  next.rendered();
  paint();
  next.freeze();
  next.rendered(); // A late event from an aborted attempt must do nothing.
  paint();
  assert.equal(container.children.length, 1);
});

test('explicit Stop removes the picture and prevents an abort from recapturing it', (t) => {
  const { hold, container, paint } = setup(t);
  const first = hold.beginAttempt();
  first.rendered();
  first.freeze();
  hold.beginAttempt().rendered();
  hold.destroy();
  first.freeze();
  paint();
  assert.equal(container.children.length, 0);
  assert.equal(container.style.position, '');
});

test('startup with no rendered picture creates no blank placeholder', (t) => {
  const { hold, container, copies } = setup(t);
  hold.beginAttempt().freeze();
  assert.equal(container.children.length, 0);
  assert.equal(copies(), 0);
});
