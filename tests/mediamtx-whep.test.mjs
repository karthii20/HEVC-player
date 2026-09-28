import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRemuxInput } from 'stream-core';

// Mirror hevc-player classify rules for Node tests (player sources are TypeScript).
function mediaMtxStreamPath(pathname) {
  let path = pathname || '/';
  path = path.replace(/\/(?:whep|whip)\/?$/i, '');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

function toWhepUrl(input) {
  const parsed = new URL(input.trim());
  let pathname = mediaMtxStreamPath(parsed.pathname);
  if (!pathname.endsWith('/')) pathname += '/';
  pathname += 'whep';
  parsed.pathname = pathname;
  parsed.hash = '';
  return parsed.toString();
}

function toMediaMtxRtspUrl(input, { port = 8554 } = {}) {
  const parsed = new URL(input.trim());
  if (['rtsp:', 'rtsps:'].includes(parsed.protocol)) return parsed.toString();
  const streamPath = mediaMtxStreamPath(parsed.pathname);
  const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
  return `rtsp://${host}:${port}${streamPath}${parsed.search}`;
}

function isMediaMtxViewerUrl(input) {
  const parsed = new URL(input.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (/\.m3u8$/i.test(parsed.pathname)) return false;
  if (/\/(?:whep|whip)\/?$/i.test(parsed.pathname)) return true;
  const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
  return last.length > 0 && !last.includes('.');
}

function classifyPasteUrl(input, { preferWhep = false, rtspPort = 8554 } = {}) {
  const url = input.trim();
  if (['rtsp:', 'rtsps:'].includes(new URL(url).protocol) || /\.m3u8$/i.test(new URL(url).pathname)) {
    return { mode: 'remux', sourceUrl: url };
  }
  if (isMediaMtxViewerUrl(url)) {
    if (preferWhep) return { mode: 'whep', whepUrl: toWhepUrl(url) };
    return {
      mode: 'remux',
      sourceUrl: toMediaMtxRtspUrl(url, { port: rtspPort }),
      derivedFromViewer: true,
    };
  }
  return { mode: 'remux', sourceUrl: url };
}

test('MediaMTX HTTPS path maps to WHEP when requested', () => {
  assert.equal(
    toWhepUrl('https://stream3.katomaran.tech/04bf29a4-2c81-41a5-8b36-07480a3c558d'),
    'https://stream3.katomaran.tech/04bf29a4-2c81-41a5-8b36-07480a3c558d/whep',
  );
  assert.ok(isMediaMtxViewerUrl('https://stream3.katomaran.tech/04bf29a4-2c81-41a5-8b36-07480a3c558d'));
  assert.equal(isMediaMtxViewerUrl('https://host/live/index.m3u8'), false);
});

test('MediaMTX HTTPS path defaults to derived RTSP remux (H.265 all browsers)', () => {
  const kind = classifyPasteUrl(
    'https://stream3.katomaran.tech/04bf29a4-2c81-41a5-8b36-07480a3c558d',
  );
  assert.equal(kind.mode, 'remux');
  assert.equal(
    kind.sourceUrl,
    'rtsp://stream3.katomaran.tech:8554/04bf29a4-2c81-41a5-8b36-07480a3c558d',
  );
  assert.equal(kind.derivedFromViewer, true);

  const whep = classifyPasteUrl('https://stream3.katomaran.tech/cam', { preferWhep: true });
  assert.equal(whep.mode, 'whep');
  assert.equal(whep.whepUrl, 'https://stream3.katomaran.tech/cam/whep');
});

test('localhost MediaMTX viewer maps RTSP to 127.0.0.1', () => {
  assert.equal(
    toMediaMtxRtspUrl('http://localhost:8889/camera1'),
    'rtsp://127.0.0.1:8554/camera1',
  );
});

test('toMediaMtxRtspUrl strips /whep and honors custom port', () => {
  assert.equal(
    toMediaMtxRtspUrl('https://media.example/live/whep', { port: 8555 }),
    'rtsp://media.example:8555/live',
  );
});

test('remux rejects MediaMTX viewer HTTPS paths without .m3u8', () => {
  assert.throws(
    () => buildRemuxInput('https://stream3.katomaran.tech/04bf29a4-2c81-41a5-8b36-07480a3c558d'),
    /RTSP|m3u8|WASM/i,
  );
  const hls = buildRemuxInput('https://media.example/live/index.m3u8');
  assert.ok(hls.input.includes('-rw_timeout'));
  assert.ok(hls.input.includes('discardcorrupt'));
});

test('RTSP remux includes low-latency probe flags', () => {
  const rtsp = buildRemuxInput('rtsp://camera/live');
  assert.ok(rtsp.input.includes('-rtsp_transport'));
  assert.ok(rtsp.input.includes('low_delay'));
  assert.ok(rtsp.input.includes('discardcorrupt'));
  assert.ok(!rtsp.input.includes('nobuffer'), 'nobuffer breaks many IP cameras');
});
