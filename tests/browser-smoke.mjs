// Manual integration check: npm run build:player && node tests/browser-smoke.mjs
// Requires local ffmpeg (libx264/libx265/AAC) and Chrome. No assets are downloaded.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { WebSocket } = require('next/dist/compiled/ws');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.env.PLAYER_DIST ?? join(root, 'packages/hevc-player/dist'));
const temp = await mkdtemp(join(tmpdir(), 'hevc-player-browser-'));
const requests = [];
const browserErrors = [];
const deniedRequests = [];
const pendingResponses = new Set();
const liveProcesses = new Set();
const liveTickets = new Map();
const liveSeconds = Number(process.env.LIVE_SOAK_SECONDS || 18);
const disconnectMs = Number(process.env.LIVE_DISCONNECT_SECONDS || 10) * 1000;
let registrations = 0;
let liveConnections = 0;
let forcedDisconnects = 0;
let chrome;
let socket;
let server;

const html = `<!doctype html><meta charset="utf-8"><title>Bundled player smoke test</title>
<style>#player { width: 320px; height: 192px; }</style><div id="player"></div>
<script>
window.smoke = { instances: [], options: [], errors: [], playing: 0 };
let constructor;
Object.defineProperty(window, 'AVPlayer', {
  configurable: true,
  get() { return constructor; },
  set(value) {
    constructor = new Proxy(value, {
      construct(target, args) {
        const instance = Reflect.construct(target, args);
        smoke.instances.push(instance);
        smoke.options.push(args[0]);
        return instance;
      }
    });
  }
});
window.addEventListener('error', event => smoke.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', event => smoke.errors.push(String(event.reason)));
</script>
<script type="module">
import { createStreamPlayer, startLiveStreamPlayer, createRemuxSession } from '/dist/index.js';
window.startSmoke = async (file) => {
  if (smoke.player) await smoke.player.destroy();
  smoke.playing = 0;
  smoke.errors = [];
  smoke.player = await createStreamPlayer(document.getElementById('player'), {
    url: '/fixtures/' + file, ...(file.endsWith('.mp4') ? { live: false } : {}),
    onPlaying: () => smoke.playing++, onError: () => smoke.errors.push('player error event')
  });
};
window.startPendingSmoke = () => {
  smoke.abortController = new AbortController();
  smoke.pendingResult = null;
  smoke.pendingEvents = [];
  createStreamPlayer(document.getElementById('player'), {
    url: '/fixtures/pending.ts', signal: smoke.abortController.signal,
    onPlaying: () => smoke.pendingEvents.push('playing'),
    onEnded: () => smoke.pendingEvents.push('ended'),
    onError: () => smoke.pendingEvents.push('error'),
  }).then(async player => {
    smoke.pendingResult = 'unexpected success';
    await player.destroy();
  }, error => { smoke.pendingResult = error.name; });
};
window.startLiveSmoke = () => {
  smoke.playing = 0;
  smoke.errors = [];
  smoke.statuses = [];
  smoke.heldFrames = [];
  smoke.player = startLiveStreamPlayer(document.getElementById('player'), {
    resolveUrl: signal => createRemuxSession('rtsp://fixture/camera', { signal }),
    onPlaying: () => smoke.playing++,
    onStatus: status => {
      smoke.statuses.push(status);
      if (status === 'Reconnecting') {
        const canvas = document.querySelector('[data-hevc-held-frame]');
        if (!canvas) { smoke.heldFrames.push(null); return; }
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let color = 0, alpha = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          color += pixels[i] + pixels[i + 1] + pixels[i + 2];
          alpha += pixels[i + 3];
        }
        smoke.heldFrames.push({ color, alpha, width: canvas.width, height: canvas.height });
      }
    },
  });
};
window.readViewport = () => {
  const canvas = document.querySelector('#player canvas');
  const container = document.getElementById('player');
  return {
    width: canvas?.width, height: canvas?.height,
    expectedWidth: container.clientWidth * devicePixelRatio,
    expectedHeight: container.clientHeight * devicePixelRatio,
  };
};
window.readPicture = () => {
  const source = document.querySelector('#player canvas');
  if (!source) return null;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d');
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
  let color = 0, alpha = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    color += pixels[i] + pixels[i + 1] + pixels[i + 2];
    alpha += pixels[i + 3];
  }
  return { color, alpha };
};
window.readSmoke = () => {
  let raw;
  try { raw = smoke.instances.at(-1)?.getStats(); } catch { /* Startup/teardown has no raw stats. */ }
  const options = smoke.options.at(-1);
  return {
    crossOriginIsolated,
    playing: smoke.playing,
    errors: smoke.errors,
    stats: smoke.player?.stats(),
    audioDecoded: Number(raw?.audioFrameDecodeCount || 0),
    audioRendered: Number(raw?.audioFrameRenderCount || 0),
    videoRendered: Number(raw?.videoFrameRenderCount || 0),
    muted: smoke.player?.isMuted(),
    software: options && !options.enableWebCodecs && !options.enableHardware && !options.checkUseMSE(),
    canvas: !!document.querySelector('#player canvas'),
  };
};
</script>`;

async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  for (const [codec, encoder] of [['h264', 'libx264'], ['h265', 'libx265']]) {
    const args = ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '8', '-c:v', encoder, '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      ...(codec === 'h265' ? ['-x265-params', 'pools=none:frame-threads=1:log-level=error', '-tag:v', 'hvc1'] : []),
      '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-movflags', '+faststart', join(temp, `${codec}.mp4`)];
    const result = spawnSync(process.env.FFMPEG ?? 'ffmpeg', args, { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`Could not generate ${codec} fixture: ${result.error || result.stderr}`);
    const transport = spawnSync(process.env.FFMPEG ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', join(temp, `${codec}.mp4`),
      '-c', 'copy', '-f', 'mpegts', join(temp, `${codec}.ts`),
    ], { encoding: 'utf8', timeout: 30000 });
    if (transport.status !== 0) throw new Error(`Could not generate ${codec} TS fixture: ${transport.error || transport.stderr}`);
  }

  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    };
    try {
      // Emulate the gateway's expiring session contract with real-time FFmpeg
      // MPEG-TS output, then cut the socket after the first ticket has expired.
      if (pathname === '/v1/sessions' && req.method === 'POST') {
        req.resume();
        const ticket = String(++registrations);
        liveTickets.set(ticket, Date.now() + Math.min(60000, disconnectMs - 1000));
        res.writeHead(201, { ...headers, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streamUrl: `/live.ts?ticket=${ticket}` }));
        return;
      }
      if (pathname === '/live.ts') {
        const ticket = new URL(req.url, 'http://localhost').searchParams.get('ticket');
        if ((liveTickets.get(ticket) || 0) <= Date.now()) {
          res.writeHead(410, headers); res.end('Expired ticket'); return;
        }
        const connection = ++liveConnections;
        const child = spawn(process.env.FFMPEG ?? 'ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1',
          '-i', join(temp, 'h265.mp4'), '-c', 'copy', '-flush_packets', '1',
          '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-f', 'mpegts', 'pipe:1',
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        liveProcesses.add(child);
        child.on('close', () => liveProcesses.delete(child));
        child.on('error', () => res.destroy());
        res.writeHead(200, { ...headers, 'Content-Type': 'video/mp2t' });
        child.stdout.pipe(res);
        const timer = connection === 1 ? setTimeout(() => {
          forcedDisconnects++;
          res.destroy();
        }, disconnectMs) : null;
        res.on('close', () => { clearTimeout(timer); child.kill('SIGKILL'); });
        return;
      }
      if (pathname === '/fixtures/pending.ts') {
        pendingResponses.add(res);
        res.on('close', () => pendingResponses.delete(res));
        res.writeHead(200, { ...headers, 'Content-Type': 'video/mp2t' });
        res.flushHeaders();
        return; // Deliberately keep startup waiting for stream data until abort.
      }
      let bytes;
      let type;
      if (pathname === '/') { bytes = Buffer.from(html); type = 'text/html'; }
      else if (pathname === '/favicon.ico') { res.writeHead(204, headers); res.end(); return; }
      else if (pathname.startsWith('/dist/')) {
        const path = resolve(dist, decodeURIComponent(pathname.slice('/dist/'.length)));
        if (!path.startsWith(dist + sep)) throw new Error('Invalid path');
        bytes = await readFile(path);
        type = extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript';
      } else if (/^\/fixtures\/h26[45]\.(mp4|ts)$/.test(pathname)) {
        bytes = await readFile(join(temp, pathname.slice('/fixtures/'.length)));
        type = pathname.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
      } else throw new Error('Only package dist and generated media are available');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
        if (start > end) { res.writeHead(416, headers); res.end(); return; }
        res.writeHead(206, { ...headers, 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': bytes.length });
        res.end(bytes);
      }
      requests.push({ path: pathname, status: res.statusCode });
    } catch (error) {
      requests.push({ path: pathname, status: 404 });
      res.writeHead(404, headers);
      res.end(String(error));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let chromeLog = '';
  chrome = spawn(process.env.CHROME ?? 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    // External hosts (including direct IP URLs) cannot bypass this unavailable proxy.
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost',
    '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'chrome')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', chunk => { chromeLog += chunk; });
  const debugPort = await waitFor(async () => {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${chromeLog}`);
    try { return (await readFile(join(temp, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch { return false; }
  }, 'Chrome debugging endpoint');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.on('message', async data => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      if (request.url.startsWith(origin + '/') || /^(blob:|data:)/.test(request.url)) {
        await send('Fetch.continueRequest', { requestId });
      } else {
        deniedRequests.push(request.url);
        await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      }
    }
  });
  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.navigate', { url: origin });
  await waitFor(() => evaluate('typeof startSmoke === "function"'), 'ES module import');
  const results = [];
  for (const fixture of ['h264.mp4', 'h265.mp4', 'h264.ts', 'h265.ts']) {
    await evaluate(`startSmoke(${JSON.stringify(fixture)})`, true);
    let last;
    await waitFor(async () => {
      last = await evaluate('readSmoke()');
      assert.deepEqual(last.errors, [], `${fixture}: page errors`);
      return last.playing > 0 && last.stats?.frames >= 12 && last.audioDecoded >= 12 && last.audioRendered > 0;
    }, `${fixture} software video and AAC decode`);
    assert.equal(last.crossOriginIsolated, true);
    assert.equal(last.software, true, `${fixture}: default software decoder`);
    assert.equal(last.muted, true, `${fixture}: default muted audio`);
    assert.equal(last.canvas, true, `${fixture}: renderer created a canvas`);
    assert.equal(last.stats.width, 160);
    assert.equal(last.stats.height, 96);
    results.push({ fixture, ...last });
  }
  await evaluate(`Object.assign(document.getElementById('player').style, { width: '640px', height: '384px' })`);
  let viewport;
  await waitFor(async () => {
    viewport = await evaluate('readViewport()');
    return viewport.width === viewport.expectedWidth && viewport.height === viewport.expectedHeight;
  }, 'canvas backing resolution after container resize', 10000);
  assert.equal(viewport.expectedWidth, 640 * await evaluate('devicePixelRatio'));
  await evaluate('smoke.player.destroy()', true);
  await evaluate('startPendingSmoke()');
  await waitFor(() => pendingResponses.size === 1, 'pending live HTTP load', 10000);
  await evaluate('smoke.abortController.abort()');
  await waitFor(async () => (await evaluate('smoke.pendingResult')) === 'AbortError', 'cancelled live player teardown', 10000);
  await waitFor(() => pendingResponses.size === 0, 'cancelled HTTP response closure', 10000);
  assert.deepEqual(await evaluate('smoke.pendingEvents'), [], 'Cancellation must suppress stale player events');
  assert.equal(await evaluate('document.querySelectorAll("#player canvas").length'), 0, 'Cancelled startup must leave no canvas');
  await evaluate('startLiveSmoke()');
  await waitFor(async () => (await evaluate('readSmoke()')).stats.frames >= 12, 'live HEVC startup');
  const publisher = [...liveProcesses][0];
  publisher.stdout.pause();
  let previousRenderCount;
  let stableSince = Date.now();
  await waitFor(async () => {
    const rendered = (await evaluate('readSmoke()')).videoRendered;
    if (rendered !== previousRenderCount) {
      stableSince = Date.now();
      previousRenderCount = rendered;
    }
    return Date.now() - stableSince >= 600;
  }, 'network pause drains buffered frames', 6000);
  const pausedPicture = await evaluate('readPicture()');
  assert.ok(pausedPicture.color > 0 && pausedPicture.alpha > 0, 'Network pause must keep a visible video picture');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(await evaluate('readPicture()'), pausedPicture, 'Last rendered picture remains unchanged while input is paused');
  assert.equal(registrations, 1, 'A short network gap must not restart the session');
  publisher.stdout.resume();
  await waitFor(async () => (await evaluate('readSmoke()')).videoRendered > previousRenderCount, 'incoming video resumes after network pause');
  assert.equal(registrations, 1, 'Playback resumes on the existing session');
  const liveStarted = Date.now();
  while (Date.now() - liveStarted < liveSeconds * 1000) {
    const current = await evaluate('readSmoke()');
    assert.deepEqual(current.errors, [], 'Live browser runtime errors');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await waitFor(async () => {
    const current = await evaluate('readSmoke()');
    return current.playing >= 2 && current.stats.frames >= 24;
  }, 'recovery with a fresh ticket after the forced disconnect', 45000);
  const recovered = await evaluate('readSmoke()');
  const heldFrames = await evaluate('smoke.heldFrames');
  assert.ok(heldFrames.length > 0, 'Reconnect must retain the last picture');
  assert.ok(heldFrames.every(frame => frame && frame.color > 0 && frame.alpha > 0), 'Retained picture must contain actual video pixels');
  assert.deepEqual(heldFrames[0], heldFrames.at(-1), 'Retry startup must not replace the retained picture with a blank frame');
  await waitFor(async () => !(await evaluate('!!document.querySelector("[data-hevc-held-frame]")')), 'remove retained picture after replacement renders');
  assert.equal(forcedDisconnects, 1);
  assert.ok(registrations >= 2, 'Recovery must register a new ticket');
  assert.ok(liveConnections >= 2, 'Recovery must open a new media connection');
  const beforeFrames = recovered.stats.frames;
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.ok((await evaluate('readSmoke()')).stats.frames > beforeFrames, 'Recovered video continues decoding');
  const liveResult = { seconds: liveSeconds, registrations, liveConnections, forcedDisconnects, pausedPicture, heldFrames, recovered };
  await evaluate('smoke.player.destroy()', true);
  await waitFor(() => liveProcesses.size === 0, 'Stop releases live FFmpeg process');
  assert.equal(await evaluate('document.querySelectorAll("#player canvas").length'), 0, 'Stop releases live renderer');
  assert.deepEqual(browserErrors, [], 'Uncaught browser errors');
  assert.deepEqual(deniedRequests, [], 'External asset requests');
  assert.equal(requests.every(request => request.status < 400), true, 'All requested assets must exist in dist');
  assert.equal(requests.some(request => /^\/(vendor|wasm)\//.test(request.path)), false, 'No application asset directories');
  console.log(JSON.stringify({ results, viewport, liveResult, cancelledPendingLoad: true, requests, deniedRequests, browserErrors }, null, 2));
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({ requests, deniedRequests, browserErrors }, null, 2));
  process.exitCode = 1;
} finally {
  for (const child of liveProcesses) child.kill('SIGKILL');
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, 'exit');
    chrome.kill('SIGKILL');
    await exited;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
