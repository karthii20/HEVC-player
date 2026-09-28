import test from 'node:test';
import assert from 'node:assert/strict';
import { remuxCandidates, resolveRemuxUrl, buildRemuxInput, validateStreamUrl } from 'stream-core';

test('URLs that already carry media are used as-is', () => {
  for (const url of [
    'rtsp://camera:554/stream',
    'rtsps://camera/stream',
    'srt://host:9999?streamid=live',
    'rtmp://host/app/stream',
    'https://host/live/index.m3u8',
    'https://host/live/llhls.m3u8?token=abc',
    'https://host/vod/movie.mp4',
  ]) {
    assert.deepEqual(remuxCandidates(url), [url], url);
  }
});

test('a MediaMTX player page offers RTSP first, then HLS', () => {
  const candidates = remuxCandidates('http://localhost:8889/camera1');
  assert.equal(candidates[0], 'rtsp://127.0.0.1:8554/camera1', 'localhost must become IPv4');
  assert.ok(candidates.some((url) => url.includes(':8888/camera1/index.m3u8')));
});

test('an OvenMediaEngine page or signaling URL offers LLHLS on its own port', () => {
  assert.equal(
    remuxCandidates('http://host:3333/app/stream')[0],
    'http://host:3333/app/stream/llhls.m3u8',
  );
  assert.equal(
    remuxCandidates('ws://host:3333/app/stream')[0],
    'http://host:3333/app/stream/llhls.m3u8',
  );
  assert.equal(
    remuxCandidates('wss://host:3334/app/stream')[0],
    'https://host:3334/app/stream/llhls.m3u8',
  );
});

test('credentials survive derivation and stay percent-encoded', () => {
  const [first] = remuxCandidates('http://admin:p%40ss@host:8889/camera1');
  assert.equal(first, 'rtsp://admin:p%40ss@host:8554/camera1');
});

test('a WHEP suffix resolves to the underlying stream path', () => {
  assert.equal(remuxCandidates('http://host:8889/camera1/whep')[0], 'rtsp://host:8554/camera1');
});

test('unsupported schemes and pathless URLs fail with status 400', () => {
  for (const url of ['file:///etc/passwd', 'ftp://host/stream']) {
    assert.throws(() => remuxCandidates(url), (error) => error.status === 400, url);
  }
  assert.throws(() => remuxCandidates('http://host:8889/'), (error) => error.status === 400);
});

test('resolveRemuxUrl keeps the first candidate that probes successfully', async () => {
  const tried = [];
  const probe = async (url) => {
    tried.push(url);
    if (!url.includes('llhls')) throw new Error('no video');
  };
  const resolved = await resolveRemuxUrl('http://host:8889/camera1', { probe });
  assert.match(resolved, /llhls\.m3u8$/);
  assert.ok(tried.length > 1, 'earlier candidates must be attempted first');
});

test('resolveRemuxUrl skips probing for unambiguous URLs and when asked', async () => {
  let probes = 0;
  const probe = async () => {
    probes += 1;
  };
  assert.equal(
    await resolveRemuxUrl('rtsp://camera/stream', { probe, skipProbe: true }),
    'rtsp://camera/stream',
  );
  assert.equal(probes, 0, 'a camera wall must not pay for probes');

  assert.equal(
    await resolveRemuxUrl('http://host:8889/camera1', { probe, skipProbe: true }),
    'rtsp://host:8554/camera1',
  );
  assert.equal(probes, 0);
});

test('resolveRemuxUrl reports how many read URLs it tried when all fail', async () => {
  const probe = async () => {
    throw new Error('connection refused');
  };
  await assert.rejects(() => resolveRemuxUrl('http://host:8889/camera1', { probe }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /Tried \d+ read URLs/);
    assert.match(error.message, /connection refused/);
    return true;
  });
});

test('SRT and RTMP are accepted and need no RTSP-only flags', () => {
  assert.equal(validateStreamUrl('srt://host:9999'), 'srt://host:9999');
  const srt = buildRemuxInput('srt://host:9999');
  assert.ok(!srt.input.includes('-rtsp_transport'));
  assert.ok(!srt.input.includes('-rw_timeout'));
  assert.equal(srt.input.at(-1), 'srt://host:9999');
});

test('WebSocket signaling is rejected with the LLHLS alternative spelled out', () => {
  assert.throws(() => buildRemuxInput('ws://host:3333/app/stream'), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /llhls/i);
    return true;
  });
});

test('player pages are rejected by buildRemuxInput so no HTML reaches the decoder', () => {
  assert.throws(() => buildRemuxInput('http://host:8889/camera1'), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /player page/i);
    return true;
  });
});
