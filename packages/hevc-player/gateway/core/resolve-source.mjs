import { StreamConfigurationError } from './stream-source.mjs';
import { probeRemuxSource } from './probe.mjs';

/** MediaMTX defaults. */
const MEDIAMTX_RTSP_PORT = 8554;
const MEDIAMTX_HLS_PORT = 8888;
const MEDIAMTX_WEBRTC_PORTS = new Set(['8889', '8189']);
/** OvenMediaEngine serves signaling and LLHLS on the same ports. */
const OME_PORTS = new Set(['3333', '3334']);

/** FFmpeg reads these directly; nothing to derive. */
const DIRECT_PROTOCOLS = new Set(['rtsp:', 'rtsps:', 'srt:', 'rtmp:', 'rtmps:']);
const PLAYLIST_PATH = /\.(?:m3u8|mpd|ts|m4s|mp4|flv)$/i;

function streamPath(pathname) {
  let path = (pathname || '/').replace(/\/(?:whep|whip)\/?$/i, '');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** FFmpeg and MediaMTX disagree about localhost → ::1; prefer IPv4 loopback. */
function ipv4Loopback(hostname) {
  return hostname === 'localhost' ? '127.0.0.1' : hostname;
}

/** URL already stores these percent-encoded; encoding again turns %40 into %2540. */
function credentials(parsed) {
  if (!parsed.username && !parsed.password) return '';
  return `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`;
}

/**
 * Ordered list of URLs that might carry the media for a pasted URL.
 *
 * A player-page URL such as http://host:8889/camera1 (MediaMTX) or
 * http://host:3333/app/stream (OvenMediaEngine) contains no media at all, and the two
 * look identical. Rather than guess a server product from the URL, offer every plausible
 * read URL — the caller probes them in order and keeps whichever delivers video.
 */
export function remuxCandidates(input) {
  const url = String(input || '').trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new StreamConfigurationError('Enter a valid absolute stream URL.', 400);
  }

  if (DIRECT_PROTOCOLS.has(parsed.protocol)) return [url];

  const isWebSocket = ['ws:', 'wss:'].includes(parsed.protocol);
  if (!isWebSocket && !['http:', 'https:'].includes(parsed.protocol)) {
    throw new StreamConfigurationError(
      'Use rtsp://, rtsps://, srt://, rtmp://, http:// or https://.',
      400,
    );
  }

  // An explicit playlist already points at media.
  if (!isWebSocket && PLAYLIST_PATH.test(parsed.pathname)) return [url];

  const path = streamPath(parsed.pathname);
  if (path === '/') {
    throw new StreamConfigurationError(
      'The stream URL needs a path, such as http://host:8889/camera1.',
      400,
    );
  }

  const host = ipv4Loopback(parsed.hostname);
  const auth = credentials(parsed);
  const scheme = ['https:', 'wss:'].includes(parsed.protocol) ? 'https' : 'http';
  const port = parsed.port;
  const query = parsed.search;

  const mediaMtxRtsp = `rtsp://${auth}${host}:${MEDIAMTX_RTSP_PORT}${path}${query}`;
  const mediaMtxHls = `${scheme}://${auth}${host}:${MEDIAMTX_HLS_PORT}${path}/index.m3u8${query}`;
  // OME publishes LLHLS on the port it signals on, under the same /<app>/<stream> path.
  const omePort = port || (scheme === 'https' ? '3334' : '3333');
  const omeLlhls = `${scheme}://${auth}${host}:${omePort}${path}/llhls.m3u8${query}`;
  const omeAbr = `${scheme}://${auth}${host}:${omePort}${path}/abr.m3u8${query}`;

  // WebSocket signaling is only ever WebRTC, so LLHLS on the same host is the read URL.
  if (isWebSocket) return unique([omeLlhls, omeAbr, mediaMtxRtsp]);
  if (OME_PORTS.has(port)) return unique([omeLlhls, omeAbr, mediaMtxRtsp, mediaMtxHls]);
  if (MEDIAMTX_WEBRTC_PORTS.has(port) || !port) {
    return unique([mediaMtxRtsp, mediaMtxHls, omeLlhls]);
  }
  // Unknown port: the pasted URL may already be a media endpoint, so try it first.
  return unique([url, mediaMtxRtsp, omeLlhls, mediaMtxHls]);
}

function unique(list) {
  return [...new Set(list)];
}

/**
 * Pick the read URL that actually delivers video.
 * Unambiguous URLs are returned untouched so a camera wall never pays for a probe;
 * ambiguous player-page URLs are probed in order.
 */
export async function resolveRemuxUrl(input, { probe = probeRemuxSource, skipProbe = false } = {}) {
  const candidates = remuxCandidates(input);
  // Nothing to choose between, so don't open the source twice. /v1/stream waits for the
  // first bytes anyway and reports the same diagnosis, and a second session can be
  // refused outright by cameras that allow only a few.
  if (candidates.length === 1 || skipProbe) return candidates[0];

  const failures = [];
  for (const candidate of candidates) {
    try {
      await probe(candidate);
      return candidate;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new StreamConfigurationError(
    `Could not read video from that URL. Tried ${candidates.length} read URLs ` +
      `(RTSP, HLS, LLHLS). Last reason: ${failures.at(-1)}`,
    502,
  );
}
