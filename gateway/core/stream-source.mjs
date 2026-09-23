import path from 'node:path';

export class StreamConfigurationError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

/** Administrator configuration only — never trust these from the browser. */
export function streamStatus(env = process.env) {
  return {
    cameraConfigured: Boolean(env.CAMERA_RTSP_URL?.trim()),
    mediaMtxConfigured: Boolean(env.MEDIAMTX_STREAM_URL?.trim()),
    defaultSource: env.MEDIAMTX_STREAM_URL?.trim()
      ? 'mediamtx'
      : env.CAMERA_RTSP_URL?.trim()
        ? 'camera'
        : 'demo',
  };
}

export function resolveStreamSource(source, env = process.env, cwd = process.cwd()) {
  if (!['demo', 'camera', 'mediamtx'].includes(source)) {
    throw new StreamConfigurationError('Unknown source', 400);
  }
  if (source === 'demo') {
    const demo = env.DEMO_MEDIA_PATH?.trim() || path.join(cwd, 'media/demo.mp4');
    return { url: null, input: ['-re', '-stream_loop', '-1', '-i', demo] };
  }

  const variable = source === 'mediamtx' ? 'MEDIAMTX_STREAM_URL' : 'CAMERA_RTSP_URL';
  const url = env[variable]?.trim();
  if (!url) throw new StreamConfigurationError(`Set ${variable} on the server first.`);

  try {
    return buildRemuxInput(url, { allowHttp: source === 'mediamtx', label: variable });
  } catch (error) {
    if (error instanceof StreamConfigurationError) throw error;
    throw new StreamConfigurationError(`${variable} must be a valid absolute URL.`);
  }
}

/** Shared FFmpeg flags for live remux.
 * Do NOT use `-fflags nobuffer` — it yields 0 bytes on many IP cameras / NVRs.
 */
const LOW_LATENCY_INPUT = [
  '-fflags',
  'discardcorrupt',
  '-flags',
  'low_delay',
  // H.265 parameter sets (VPS/SPS/PPS) only arrive with a keyframe, so a camera with a
  // long I-frame interval can take 10s+ to describe itself. FFmpeg's ~5s default made it
  // give up on healthy streams. These are ceilings, not waits: analysis ends as soon as
  // the codec is known, so fast cameras still start immediately.
  '-analyzeduration',
  '20000000',
  '-probesize',
  '20000000',
];

/**
 * Build FFmpeg input args for a paste-or-config URL.
 * RTSP uses TCP transport; HTTP/HTTPS (MediaMTX HLS) uses a read timeout.
 */
/** Container formats FFmpeg can pull over HTTP and remux without transcoding. */
const HTTP_MEDIA_PATH = /\.(?:m3u8|mpd|ts|m4s|mp4|flv)$/i;

export function buildRemuxInput(url, { allowHttp = true, label = 'Stream URL' } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new StreamConfigurationError(`${label} must be a valid absolute URL.`);
  }
  if (/\/(?:whep|whip)\/?$/i.test(parsed.pathname)) {
    throw new StreamConfigurationError(
      `${label} cannot use a WHEP/WHIP signaling URL. Set the RTSP or HLS read URL for the same MediaMTX stream.`,
    );
  }
  // OvenMediaEngine and other servers signal WebRTC over WebSockets, which carries no
  // media FFmpeg can read. Their LLHLS playlist serves the same stream.
  if (['ws:', 'wss:'].includes(parsed.protocol)) {
    throw new StreamConfigurationError(
      `${label} is a WebRTC signaling URL (ws/wss), which carries no media to remux. ` +
        'Use the LLHLS playlist for the same stream instead, e.g. ' +
        'http://host:3333/<app>/<stream>/llhls.m3u8.',
      400,
    );
  }
  if (['rtsp:', 'rtsps:'].includes(parsed.protocol)) {
    // Avoid FFmpeg -timeout / -rw_timeout on RTSP: versions disagree and can break.
    return {
      url,
      input: [...LOW_LATENCY_INPUT, '-rtsp_transport', 'tcp', '-i', url],
    };
  }
  // SRT and RTMP carry media directly, so no probing hints are needed.
  if (['srt:', 'rtmp:', 'rtmps:', 'rtmpt:', 'rtmpe:'].includes(parsed.protocol)) {
    return { url, input: [...LOW_LATENCY_INPUT, '-i', url] };
  }
  if (allowHttp && ['http:', 'https:'].includes(parsed.protocol)) {
    // MediaMTX and OME both publish /<path> as an HTML player page with no media on it.
    // Remuxing that page produces AVPlayer "open stream failed".
    const leaf = parsed.pathname.split('/').filter(Boolean).pop() || '';
    if (!HTTP_MEDIA_PATH.test(parsed.pathname) && leaf && !leaf.includes('.')) {
      throw new StreamConfigurationError(
        `${label} looks like a player page, not a stream. Paste the RTSP read URL ` +
          '(rtsp://host:8554/<path>) or a playlist URL (…/index.m3u8, …/llhls.m3u8) ' +
          'so H.265 can remux into WASM.',
        400,
      );
    }
    return {
      url,
      input: [...LOW_LATENCY_INPUT, '-rw_timeout', '15000000', '-i', url],
    };
  }
  throw new StreamConfigurationError(
    `${label} must use ${
      allowHttp ? 'RTSP, RTSPS, SRT, RTMP, HTTP or HTTPS' : 'RTSP or RTSPS'
    }.`,
  );
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
        try {
          result = result.split(decodeURIComponent(value)).join('[redacted]');
        } catch {}
      }
    } catch {}
  }
  return result.replace(/(?:rtsps?|https?):\/\/[^\s]+/gi, '[stream URL]').slice(-4000).trim();
}
