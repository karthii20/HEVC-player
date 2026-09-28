import path from 'node:path';

export class StreamConfigurationError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

// These inputs are administrator configuration, never client-supplied URLs.
export function streamStatus(env = process.env) {
  return {
    cameraConfigured: Boolean(env.CAMERA_RTSP_URL?.trim()),
    mediaMtxConfigured: Boolean(env.MEDIAMTX_STREAM_URL?.trim()),
    defaultSource: env.MEDIAMTX_STREAM_URL?.trim() ? 'mediamtx' : env.CAMERA_RTSP_URL?.trim() ? 'camera' : 'demo',
  };
}

export function resolveStreamSource(source, env = process.env, cwd = process.cwd()) {
  if (!['demo', 'camera', 'mediamtx'].includes(source)) {
    throw new StreamConfigurationError('Unknown source', 400);
  }
  if (source === 'demo') {
    return { url: null, input: ['-re', '-stream_loop', '-1', '-i', path.join(cwd, 'public/media/demo.mp4')] };
  }

  const variable = source === 'mediamtx' ? 'MEDIAMTX_STREAM_URL' : 'CAMERA_RTSP_URL';
  const url = env[variable]?.trim();
  if (!url) throw new StreamConfigurationError(`Set ${variable} on the server first.`);

  let parsed;
  try { parsed = new URL(url); } catch {
    throw new StreamConfigurationError(`${variable} must be a valid absolute URL.`);
  }
  if (/\/whep\/?$/i.test(parsed.pathname)) {
    throw new StreamConfigurationError(`${variable} cannot use a WHEP signaling URL. Set the RTSP or HLS read URL for the same MediaMTX stream.`);
  }
  if (['rtsp:', 'rtsps:'].includes(parsed.protocol)) {
    // RTSP timeout options differ across FFmpeg versions: -timeout can enable
    // listen mode, and -rw_timeout can be rejected after a successful handshake.
    // The gateway's 20-second watchdog (and diagnostic script's 25-second
    // deadline) bounds stalled input without relying on these options.
    return { url, input: ['-rtsp_transport', 'tcp', '-i', url] };
  }
  if (source === 'mediamtx' && ['http:', 'https:'].includes(parsed.protocol)) {
    // Accept extensionless HLS endpoints too. FFmpeg probes the response format.
    return { url, input: ['-rw_timeout', '15000000', '-i', url] };
  }
  throw new StreamConfigurationError(`${variable} must use ${source === 'mediamtx' ? 'RTSP, RTSPS, HTTP or HTTPS' : 'RTSP or RTSPS'}.`);
}

export function redactStreamDiagnostics(text, url) {
  let result = text;
  if (url) {
    result = result.split(url).join('[stream URL]');
    try {
      const parsed = new URL(url);
      const secrets = [parsed.username, parsed.password, ...parsed.searchParams.values()];
      for (const value of secrets) {
        if (!value) continue;
        result = result.split(value).join('[redacted]');
        try { result = result.split(decodeURIComponent(value)).join('[redacted]'); } catch {}
      }
    } catch {}
  }
  return result.replace(/(?:rtsps?|https?):\/\/[^\s]+/gi, '[stream URL]').slice(-4000).trim();
}
