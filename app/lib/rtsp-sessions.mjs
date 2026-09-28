import { randomBytes } from 'node:crypto';
import { StreamConfigurationError } from './stream-source.mjs';

export function validateRtspUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StreamConfigurationError('Enter an RTSP URL.', 400);
  }
  const url = value.trim();
  if (url.length > 4096 || /[\u0000-\u0020\u007f]/.test(url)) {
    throw new StreamConfigurationError('The RTSP URL contains spaces, invalid characters, or is too long. Percent-encode credentials.', 400);
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new StreamConfigurationError('Enter a valid RTSP URL, such as rtsp://camera:554/stream.', 400);
  }
  if (!['rtsp:', 'rtsps:'].includes(parsed.protocol) || !parsed.hostname || parsed.hash || /\/whep\/?$/i.test(parsed.pathname)) {
    throw new StreamConfigurationError('Use an rtsp:// or rtsps:// camera read URL, not an HTTP or WHEP URL.', 400);
  }
  if (parsed.port && (+parsed.port < 1 || +parsed.port > 65535)) {
    throw new StreamConfigurationError('The RTSP port must be between 1 and 65535.', 400);
  }
  return url;
}

// Short-lived tickets keep RTSP credentials out of GET/access-log URLs.
// A player can reopen the media URL during startup or a brief network recovery.
export function createRtspSessions({ ttlMs = 60_000, limit = 32 } = {}) {
  const entries = new Map();
  return {
    add(value) {
      const url = validateRtspUrl(value);
      if (entries.size >= limit) throw new StreamConfigurationError('Too many pending streams. Try again in a minute.', 429);
      const id = randomBytes(24).toString('hex');
      const timer = setTimeout(() => entries.delete(id), ttlMs);
      timer.unref();
      entries.set(id, { url, timer, expires: Date.now() + ttlMs });
      return id;
    },
    take(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      if (entry.expires <= Date.now()) {
        entries.delete(id);
        clearTimeout(entry.timer);
        return null;
      }
      return entry.url;
    },
  };
}

const state = globalThis;
export const rtspSessions = state.hevcRtspSessions ??= createRtspSessions();

export function isSameOriginRequest(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true; // Also allow direct server/CLI clients.
  try { return new URL(origin).host === (request.headers.get('host') || new URL(request.url).host); }
  catch { return false; }
}

export async function readRtspRequest(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new StreamConfigurationError('Send the RTSP URL as JSON.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new StreamConfigurationError('Enter an RTSP URL.', 400);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new StreamConfigurationError('The RTSP request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StreamConfigurationError('Invalid JSON request.', 400); }
  return validateRtspUrl(body?.url);
}
