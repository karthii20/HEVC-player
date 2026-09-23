import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  StreamConfigurationError,
  streamStatus,
  resolveStreamSource,
  buildRemuxInput,
  createRtspSessions,
  validateStreamUrl,
  createSharedRemuxHub,
  pipeRemuxResponse,
  resolveRemuxUrl,
  humanizeProbeFailure,
} from './core/index.mjs';

// Packaged gateway resolves configuration and optional demo files from the caller.
const ROOT = process.cwd();
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.STREAMING_PORT || 3002);
const HOST = process.env.BIND_ADDRESS || '127.0.0.1';
const PUBLIC_URL = (process.env.STREAM_PUBLIC_URL || `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`).replace(/\/$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
// Max concurrent HTTP viewers (fan-out clients), not unique FFmpeg processes.
const MAX_CONNECTIONS = Number(process.env.STREAM_MAX_CONNECTIONS || 64);
// Max unique camera remuxes (1 FFmpeg each). Many viewers of the same URL share one.
const MAX_SOURCES = Number(process.env.STREAM_MAX_SOURCES || 64);

const sessions = createRtspSessions();
const remuxHub = createSharedRemuxHub({
  maxSources: MAX_SOURCES,
  idleStopMs: Number(process.env.STREAM_SOURCE_IDLE_MS || 15_000),
  sourceTimeoutMs: Number(process.env.STREAM_SOURCE_TIMEOUT_MS || 30_000),
  maxViewerQueueBytes: Number(process.env.STREAM_VIEWER_QUEUE_BYTES || 1024 * 1024),
});
const state = { connections: 0 };

function corsHeaders(request) {
  const origin = request.headers.origin;
  const headers = {
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (origin && isAllowed(request)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers.Vary = 'Origin';
  }
  return headers;
}

/**
 * Dev servers hop ports (Vite moves to 5174 when 5173 is busy), which silently turned
 * into "Failed to fetch" in the browser. Outside production, trust any loopback origin.
 */
const ALLOW_LOOPBACK_ORIGINS =
  process.env.ALLOW_LOOPBACK_ORIGINS === 'true' ||
  (process.env.ALLOW_LOOPBACK_ORIGINS !== 'false' && process.env.NODE_ENV !== 'production');

function isLoopbackOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (!['http:', 'https:'].includes(protocol)) return false;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOW_LOOPBACK_ORIGINS && isLoopbackOrigin(origin);
}

function sendJson(response, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extra,
  });
  response.end(payload);
}

async function readJsonBody(request, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new StreamConfigurationError('The stream request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StreamConfigurationError('Invalid JSON request.', 400);
  }
}

async function handleRegister(request, response, headers) {
  if (!isAllowed(request)) {
    sendJson(response, 403, { error: 'Forbidden' }, headers);
    return;
  }
  try {
    if ((request.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      throw new StreamConfigurationError('Send the stream URL as JSON.', 415);
    }
    const body = await readJsonBody(request);
    const url = validateStreamUrl(body?.url);
    // Resolve player-page URLs (MediaMTX/OME) to a read URL that actually carries media,
    // and fail here with a clear message rather than handing AVPlayer an empty pipe.
    const resolvedUrl = await resolveRemuxUrl(url, { skipProbe: body?.skipProbe === true });
    const ticket = sessions.add(resolvedUrl);
    sendJson(response, 201, { streamUrl: `${PUBLIC_URL}/v1/stream?ticket=${ticket}` }, headers);
  } catch (error) {
    if (error instanceof StreamConfigurationError) {
      sendJson(response, error.status, { error: error.message }, headers);
      return;
    }
    console.error('[streaming] register failed', error);
    sendJson(response, 500, { error: 'Unable to create stream.' }, headers);
  }
}

async function handleStream(request, response, headers) {
  if (!isAllowed(request)) {
    response.writeHead(403, headers);
    response.end('Forbidden');
    return;
  }
  if (state.connections >= MAX_CONNECTIONS) {
    response.writeHead(429, headers);
    response.end('Preview connection limit reached.');
    return;
  }

  const url = new URL(request.url, PUBLIC_URL);
  const source = url.searchParams.get('source') || streamStatus().defaultSource;
  let resolved;
  try {
    if (url.searchParams.has('ticket')) {
      const ticketUrl = sessions.take(url.searchParams.get('ticket'));
      if (!ticketUrl) {
        response.writeHead(410, headers);
        response.end('Stream request expired. Start the stream again.');
        return;
      }
      // Tickets may be RTSP cameras or MediaMTX HTTP/HLS read URLs.
      resolved = buildRemuxInput(ticketUrl, { allowHttp: true, label: 'Pasted stream URL' });
    } else {
      resolved = resolveStreamSource(source, process.env, ROOT);
    }
  } catch (error) {
    const status = error instanceof StreamConfigurationError ? error.status : 500;
    response.writeHead(status, headers);
    response.end(error instanceof Error ? error.message : 'Stream error');
    return;
  }

  let stream;
  try {
    // Same RTSP/HLS URL → one FFmpeg; additional viewers subscribe to that pipe.
    stream = remuxHub.subscribe({
      inputArgs: resolved.input,
      sourceUrl: resolved.url,
      onViewerChange: (delta) => {
        state.connections = Math.max(0, state.connections + delta);
      },
    });
  } catch (error) {
    const status = error instanceof StreamConfigurationError ? error.status : 500;
    response.writeHead(status, headers);
    response.end(error instanceof Error ? error.message : 'Stream error');
    return;
  }

  const explain = (fallback) =>
    humanizeProbeFailure(stream.diagnostics?.() || '', resolved.url, fallback);
  await pipeRemuxResponse(stream, response, { headers, explain });
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  const pathName = new URL(request.url || '/', PUBLIC_URL).pathname;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.method === 'GET' && pathName === '/health') {
    const remux = remuxHub.stats();
    sendJson(response, 200, {
      ok: true,
      service: 'streaming',
      connections: state.connections,
      maxConnections: MAX_CONNECTIONS,
      // Shared remux: viewers share one FFmpeg per unique source URL.
      sources: remux.sources,
      maxSources: MAX_SOURCES,
      sharedRemux: true,
      codecs: ['H.264', 'H.265'],
      transport: 'MPEG-TS over HTTP',
    }, headers);
    return;
  }

  if (request.method === 'POST' && (pathName === '/v1/sessions' || pathName === '/api/stream')) {
    await handleRegister(request, response, headers);
    return;
  }

  if (request.method === 'GET' && (pathName === '/v1/stream' || pathName === '/api/stream')) {
    await handleStream(request, response, headers);
    return;
  }

  response.writeHead(404, headers);
  response.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[streaming] listening on http://${HOST}:${PORT} (public ${PUBLIC_URL})`);
});
