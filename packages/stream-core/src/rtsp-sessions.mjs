import { randomBytes } from 'node:crypto';
import { StreamConfigurationError } from './stream-source.mjs';

const ALLOWED_PROTOCOLS = new Set([
  'rtsp:',
  'rtsps:',
  'http:',
  'https:',
  'srt:',
  'rtmp:',
  'rtmps:',
  // WebRTC signaling carries no media, but a pasted ws(s) URL still identifies a stream
  // whose LLHLS read URL can be derived. resolveRemuxUrl does that derivation.
  'ws:',
  'wss:',
]);

/**
 * Accept camera RTSP plus any server read URL FFmpeg can pull media from:
 * MediaMTX (RTSP/HLS), OvenMediaEngine (LLHLS), SRT and RTMP.
 * Reject WHEP/WHIP signaling and local file schemes.
 */
export function validateStreamUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StreamConfigurationError('Enter a stream URL.', 400);
  }
  const url = value.trim();
  if (url.length > 4096 || /[\u0000-\u0020\u007f]/.test(url)) {
    throw new StreamConfigurationError(
      'The stream URL contains spaces, invalid characters, or is too long. Percent-encode credentials.',
      400,
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new StreamConfigurationError(
      'Enter a valid URL, such as rtsp://camera:554/stream or https://host/path/index.m3u8.',
      400,
    );
  }
  if (!parsed.hostname || parsed.hash) {
    throw new StreamConfigurationError('Enter a valid absolute stream URL without a #fragment.', 400);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new StreamConfigurationError(
      'Use rtsp://, rtsps://, srt://, rtmp://, http:// or https://. ' +
        'File and other schemes are not allowed.',
      400,
    );
  }
  if (parsed.port && (+parsed.port < 1 || +parsed.port > 65535)) {
    throw new StreamConfigurationError('The URL port must be between 1 and 65535.', 400);
  }
  return url;
}

/** @deprecated Prefer validateStreamUrl — kept for older imports. */
export function validateRtspUrl(value) {
  return validateStreamUrl(value);
}

/**
 * Short-lived tickets keep RTSP credentials out of GET / access-log URLs.
 * Tickets stay valid until TTL expires (not one-shot): AVPlayer may open the
 * MPEG-TS URL more than once on reconnect, and a one-shot ticket caused 410 Gone.
 */
export function createRtspSessions({ ttlMs = 60_000, limit = 64 } = {}) {
  const entries = new Map();
  return {
    add(value) {
      const url = validateStreamUrl(value);
      if (entries.size >= limit) {
        throw new StreamConfigurationError('Too many pending streams. Try again in a minute.', 429);
      }
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

export async function readRtspRequest(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new StreamConfigurationError('Send the stream URL as JSON.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new StreamConfigurationError('Enter a stream URL.', 400);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new StreamConfigurationError('The stream request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StreamConfigurationError('Invalid JSON request.', 400);
  }
  return validateStreamUrl(body?.url);
}
