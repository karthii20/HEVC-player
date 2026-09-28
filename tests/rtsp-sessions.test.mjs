import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtspSessions, validateStreamUrl, buildRemuxInput } from 'stream-core';
import { createRtspSessions as createAppRtspSessions } from '../app/lib/rtsp-sessions.mjs';

test('validateStreamUrl accepts RTSP and MediaMTX HTTP/HLS read URLs', () => {
  const rtsp = 'rtsp://viewer:p%40ss@192.168.1.2:554/live?channel=1';
  assert.equal(validateStreamUrl(rtsp), rtsp);
  assert.equal(validateStreamUrl('rtsps://[::1]:8554/live'), 'rtsps://[::1]:8554/live');
  assert.equal(
    validateStreamUrl('https://media.example/live/index.m3u8?token=abc'),
    'https://media.example/live/index.m3u8?token=abc',
  );
  assert.equal(
    validateStreamUrl('http://127.0.0.1:8888/cam1/index.m3u8'),
    'http://127.0.0.1:8888/cam1/index.m3u8',
  );
});

test('validateStreamUrl rejects files and unsafe values', () => {
  for (const value of [
    null,
    '',
    12,
    'file:///etc/passwd',
    'rtsp://',
    'rtsp://host:99999/live',
    'rtsp://host/live\n-i',
    'rtsp://host/live#fragment',
    'rtsp://host/' + 'a'.repeat(4096),
  ]) {
    assert.throws(() => validateStreamUrl(value));
  }
});

test('a pasted WHEP or signaling URL is accepted so it can be resolved, never remuxed raw', () => {
  for (const url of [
    'https://media/live/whep',
    'https://user:secret@media/live/whep/',
    'ws://host:3333/app/stream',
  ]) {
    assert.equal(validateStreamUrl(url), url, 'must survive validation to reach resolution');
    assert.throws(() => buildRemuxInput(url), (error) => {
      assert.match(error.message, /RTSP|HLS|llhls/i, 'must name a read URL to use instead');
      assert.doesNotMatch(error.message, /secret/, 'errors must not leak credentials');
      return true;
    });
  }
});

test('buildRemuxInput chooses RTSP transport or HTTP timeout', () => {
  const rtsp = buildRemuxInput('rtsp://camera/live');
  assert.ok(rtsp.input.includes('-rtsp_transport'));
  assert.ok(!rtsp.input.includes('-rw_timeout'));
  const hls = buildRemuxInput('https://media/live/index.m3u8');
  assert.ok(hls.input.includes('-rw_timeout'));
  assert.ok(!hls.input.includes('-rtsp_transport'));
  assert.throws(() => buildRemuxInput('https://media/live/whep'), /WHEP|WHIP/);
});

test('stream tickets are opaque, reusable until TTL, bounded and expire', async () => {
  const sessions = createRtspSessions({ ttlMs: 40, limit: 2 });
  const url = 'https://media/live/index.m3u8';
  const ticket = sessions.add(url);
  assert.match(ticket, /^[a-f0-9]{48}$/);
  // Live players may open the same MPEG-TS URL more than once (reconnect / probe).
  assert.equal(sessions.take(ticket), url);
  assert.equal(sessions.take(ticket), url);
  const next = sessions.add(url);
  assert.notEqual(next, ticket);
  // ticket + next already fill the limit of 2
  assert.throws(() => sessions.add('rtsp://third/camera'), (error) => error.status === 429);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sessions.take(ticket), null);
  assert.equal(sessions.take(next), null);
});

test('Next stream tickets survive a media reconnect but still expire', async () => {
  const sessions = createAppRtspSessions({ ttlMs: 40, limit: 1 });
  const url = 'rtsp://camera/live';
  const ticket = sessions.add(url);
  assert.equal(sessions.take(ticket), url);
  assert.equal(sessions.take(ticket), url);
  assert.throws(() => sessions.add(url), (error) => error.status === 429);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sessions.take(ticket), null);
  assert.notEqual(sessions.add(url), ticket);
});
