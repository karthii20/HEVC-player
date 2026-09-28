import test from 'node:test';
import assert from 'node:assert/strict';
import { startLivePlayback } from '../packages/hevc-player/dist/live-playback.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check) {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Playback did not reach the expected state');
    await sleep(2);
  }
}

function setup(t, options = {}) {
  const attempts = [];
  const states = [];
  const players = [];
  const controller = startLivePlayback({
    retryMinMs: 5,
    retryMaxMs: 20,
    pollMs: 5,
    stallMs: 1000,
    startupMs: 1000,
    onState: (state, delay) => states.push({ state, delay }),
    onPlayer: (player) => players.push(player),
    async connect(callbacks) {
      // Each invocation represents a new registration, with its own ticket.
      assert.equal(attempts.every((a) => a.player.destroyed), true, 'old decoder must be destroyed first');
      const player = {
        frames: 0,
        destroyed: false,
        stats() { return { frames: this.frames }; },
        async destroy() { this.destroyed = true; },
      };
      attempts.push({ ...callbacks, player });
      return player;
    },
    ...options,
  });
  t.after(() => controller.stop());
  return { controller, attempts, states, players };
}

test('live EOF/error/timeout recover once with a fresh connection and ignore stale events', async (t) => {
  const { attempts, states, players } = setup(t);
  await waitFor(() => players.filter(Boolean).length === 1);
  const first = attempts[0];
  first.onPlaying();
  assert.equal(states.at(-1).state, 'Playing');
  first.onInterrupted();
  first.onInterrupted();
  first.onInterrupted();
  await waitFor(() => players.filter(Boolean).length === 2);
  const previousLength = states.length;
  first.onPlaying();
  first.onInterrupted();
  assert.equal(states.length, previousLength);
  assert.equal(attempts.length, 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.player.destroyed, true);
  attempts[1].onPlaying();
  assert.equal(states.at(-1).state, 'Playing');
});

test('Stop cancels pending retry and destroys the current player', async (t) => {
  const { controller, attempts, states } = setup(t, { retryMinMs: 40 });
  await waitFor(() => attempts.length === 1);
  attempts[0].onInterrupted();
  await waitFor(() => states.some((s) => s.delay));
  await controller.stop();
  await sleep(60);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].player.destroyed, true);
});

test('Stop aborts an in-flight registration and never publishes a late player', async (t) => {
  let finish;
  let signal;
  let destroyed = false;
  const { controller, players } = setup(t, {
    connect: (callbacks) => {
      signal = callbacks.signal;
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  await waitFor(() => finish);
  const stopping = controller.stop();
  assert.equal(signal.aborted, true);
  finish({ destroy: async () => { destroyed = true; } });
  await stopping;
  assert.equal(destroyed, true);
  assert.deepEqual(players, [null]);
});

test('frozen decoding reconnects even when no ended event is emitted', async (t) => {
  const { attempts } = setup(t, { stallMs: 25 });
  await waitFor(() => attempts.length === 2);
  assert.equal(attempts[0].player.destroyed, true);
});

test('progressing live video is kept open', async (t) => {
  const { attempts } = setup(t, { stallMs: 35 });
  await waitFor(() => attempts.length === 1);
  const timer = setInterval(() => { attempts[0].player.frames++; }, 5);
  t.after(() => clearInterval(timer));
  await sleep(100);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].player.destroyed, false);
});

test('a hung startup is aborted and retried', async (t) => {
  let calls = 0;
  const { states } = setup(t, {
    startupMs: 20,
    connect: ({ signal }) => {
      calls++;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  await waitFor(() => calls === 2);
  assert.equal(states.some((s) => s.state === 'Reconnecting'), true);
});

test('repeated failures back off to a capped interval', async (t) => {
  const { states } = setup(t, { connect: async () => { throw new Error('offline'); } });
  await waitFor(() => states.filter((s) => s.delay).length >= 4);
  assert.deepEqual(states.filter((s) => s.delay).slice(0, 4).map((s) => s.delay), [5, 10, 20, 20]);
});

test('rendering a single frame before freezing does not reset retry backoff', async (t) => {
  const { states } = setup(t, {
    stallMs: 15,
    stableMs: 15,
    async connect({ onPlaying }) {
      onPlaying();
      return { stats: () => ({ frames: 1 }), destroy: async () => {} };
    },
  });
  await waitFor(() => states.filter((s) => s.delay).length >= 3);
  assert.deepEqual(states.filter((s) => s.delay).slice(0, 3).map((s) => s.delay), [5, 10, 20]);
});

test('invalid registration fails visibly without retrying', async (t) => {
  let calls = 0;
  let fatal = false;
  let message;
  setup(t, {
    connect: async () => {
      calls++;
      throw Object.assign(new Error('Use a valid RTSP URL.'), { retryable: false });
    },
    onError: (error) => { message = error; },
    onFatal: () => { fatal = true; },
  });
  await waitFor(() => fatal);
  assert.equal(message, 'Use a valid RTSP URL.');
  await sleep(30);
  assert.equal(calls, 1);
});
