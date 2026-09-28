import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStreamSource, streamStatus, redactStreamDiagnostics } from 'stream-core';

test('MediaMTX is preferred, camera and demo remain available, status exposes no URLs', () => {
  const env = { CAMERA_RTSP_URL: 'rtsp://user:secret@camera/live', MEDIAMTX_STREAM_URL: 'https://media/live/index.m3u8?token=private' };
  assert.deepEqual(streamStatus(env), { cameraConfigured: true, mediaMtxConfigured: true, defaultSource: 'mediamtx' });
  assert.equal(streamStatus({ CAMERA_RTSP_URL: env.CAMERA_RTSP_URL }).defaultSource, 'camera');
  assert.equal(streamStatus({ MEDIAMTX_STREAM_URL: '  ' }).defaultSource, 'demo');
});

test('RTSP options are not passed to HTTP/HLS inputs', () => {
  const rtsp = resolveStreamSource('mediamtx', { MEDIAMTX_STREAM_URL: 'rtsps://media/live' });
  assert.ok(rtsp.input.includes('-rtsp_transport'));
  assert.ok(!rtsp.input.includes('-timeout'), 'legacy FFmpeg would enable RTSP listen mode');
  assert.ok(!rtsp.input.includes('-rw_timeout'), 'RTSP can reject this after a successful handshake');
  const hls = resolveStreamSource('mediamtx', { MEDIAMTX_STREAM_URL: 'https://media/live/index.m3u8' });
  assert.ok(hls.input.includes('-rw_timeout'));
  assert.ok(!hls.input.includes('-rtsp_transport'));
  assert.equal(hls.input.at(-1), hls.url);
});

test('WHEP including query strings and trailing slash fails with an actionable, safe error', () => {
  for (const suffix of ['/whep', '/whep/?token=private', '/WHEP?token=private']) {
    assert.throws(() => resolveStreamSource('mediamtx', { MEDIAMTX_STREAM_URL: `https://user:secret@media/live${suffix}` }), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /RTSP or HLS/);
      assert.doesNotMatch(error.message, /secret|private/);
      return true;
    });
  }
});

test('unknown sources, local file inputs, malformed and missing configuration are rejected', () => {
  assert.throws(() => resolveStreamSource('https://arbitrary/live', {}), error => error.status === 400);
  for (const url of ['', 'not a URL', 'file:///etc/passwd', 'pipe:0']) {
    assert.throws(() => resolveStreamSource('mediamtx', { MEDIAMTX_STREAM_URL: url }), error => error.status === 503);
  }
  assert.throws(() => resolveStreamSource('camera', { CAMERA_RTSP_URL: 'https://media/live' }), /RTSP or RTSPS/);
});

test('diagnostics remove credentials, query tokens, full URLs and HLS segment URLs', () => {
  const url = 'https://viewer:p%40ssword@media/live/index.m3u8?token=privateToken';
  const message = `${url}\npassword p@ssword p%40ssword user viewer token privateToken\nhttps://media/live/segment.mp4?token=otherToken`;
  const safe = redactStreamDiagnostics(message, url);
  assert.doesNotMatch(safe, /viewer|p@ssword|p%40ssword|privateToken|otherToken|https:\/\//);
});
