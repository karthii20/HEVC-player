import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizeProbeFailure } from 'stream-core';

test('humanizeProbeFailure explains connection refused', () => {
  const message = humanizeProbeFailure(
    'Connection to tcp://stream3.example:8554 failed: Connection refused',
    'rtsp://stream3.example:8554/cam',
    'fallback',
  );
  assert.match(message, /connection refused/i);
  assert.match(message, /WHEP|WebRTC|RTSP/i);
});
