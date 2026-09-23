import { spawn } from 'node:child_process';
import { buildRemuxInput, StreamConfigurationError, redactStreamDiagnostics } from './stream-source.mjs';

/**
 * Quickly verify FFmpeg can open the URL and produce MPEG-TS bytes.
 * Used when registering a paste ticket so the UI fails with a clear message
 * instead of AVPlayer "open stream failed, ret: -2" on an empty pipe.
 */
export function probeRemuxSource(url, {
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  // A viewer cannot decode until the next keyframe, and cameras with a long I-frame
  // interval make that 13s or more. Anything shorter rejects healthy streams.
  timeoutMs = 20_000,
  minBytes = 64,
} = {}) {
  const { input, url: sourceUrl } = buildRemuxInput(url, {
    allowHttp: true,
    label: 'Pasted stream URL',
  });

  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        ...input,
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'copy',
        '-t',
        '1',
        '-f',
        'mpegts',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    let bytes = 0;
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {}
      if (error) reject(error);
      else resolve({ bytes });
    };

    const timer = setTimeout(() => {
      if (bytes >= minBytes) finish();
      else {
        finish(
          new StreamConfigurationError(
            humanizeProbeFailure(stderr, sourceUrl, 'Timed out waiting for video from the stream URL.'),
            502,
          ),
        );
      }
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16384);
    });
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes >= minBytes) finish();
    });
    child.on('error', () => {
      finish(
        new StreamConfigurationError(
          'Unable to start FFmpeg. Check server installation (FFMPEG_PATH).',
          500,
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      if (bytes >= minBytes) {
        finish();
        return;
      }
      finish(
        new StreamConfigurationError(
          humanizeProbeFailure(
            stderr,
            sourceUrl,
            code
              ? 'Stream unavailable. FFmpeg could not remux this URL.'
              : 'Stream produced no video. Check that the path is publishing.',
          ),
          502,
        ),
      );
    });
  });
}

export function humanizeProbeFailure(stderr, sourceUrl, fallback) {
  const text = redactStreamDiagnostics(stderr || '', sourceUrl).toLowerCase();
  if (/connection refused/.test(text)) {
    return (
      'RTSP/HLS connection refused. This MediaMTX host is not exposing RTSP (ports 554/8554) ' +
      'or HLS to this server. Paste a reachable rtsp:// URL, enable MediaMTX RTSP/HLS, ' +
      'or use the HTTPS viewer URL with WebRTC (native decode — H.265 is not guaranteed).'
    );
  }
  if (/timed out|timeout|no route|network is unreachable|name or service not known|temporary failure in name resolution/.test(text)) {
    return (
      'Cannot reach the stream URL from the streaming server (DNS/network/timeout). ' +
      'Confirm the host is reachable and the correct RTSP port is open (often 8554 for MediaMTX).'
    );
  }
  if (/too many (?:users|connections|clients)|max.{0,12}(?:sessions|clients) reached/.test(text)) {
    return (
      'The camera/NVR refused the connection: too many users are already connected. ' +
      'IP cameras allow only a few simultaneous RTSP sessions per account. Let MediaMTX hold one ' +
      'persistent session per camera (sourceOnDemand: no) and read every viewer from MediaMTX.'
    );
  }
  if (/401|403|unauthorized|authentication/.test(text)) {
    return 'Stream authentication failed. Check username/password in the RTSP URL.';
  }
  if (/could not find codec parameters|unspecified size/.test(text)) {
    return (
      'The stream connected but delivered no video packets (only the track description). ' +
      'The camera is usually still waiting on a keyframe, or the upstream source is not publishing. ' +
      'Retry in a few seconds, or keep the MediaMTX path always-on so a keyframe is already buffered.'
    );
  }
  if (/404|not found|404 not found/.test(text)) {
    return 'Stream path not found. Confirm the MediaMTX path name is correct and publishing.';
  }
  const detail = redactStreamDiagnostics(stderr || '', sourceUrl);
  return detail ? `${fallback} ${detail}` : fallback;
}
