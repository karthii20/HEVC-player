import { spawn } from 'node:child_process';
import { redactStreamDiagnostics } from './stream-source.mjs';

/**
 * Copy H.264/H.265 video and normalize optional camera audio to AAC in MPEG-TS.
 * Audio encoding happens once per shared source, never once per viewer.
 */
export function createMpegTsRemux({
  inputArgs,
  sourceUrl = null,
  signal,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  idleMs = 20_000,
  onConnectionChange,
  logPrefix = '[streaming]',
} = {}) {
  const processHandle = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      // `warning`, not `error`: the reason a camera fails to start ("unspecified size",
      // "no startcode") is logged as a warning and would otherwise be invisible.
      '-loglevel',
      'warning',
      ...inputArgs,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-flush_packets',
      '1',
      '-mpegts_flags',
      '+resend_headers+initial_discontinuity',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      '-f',
      'mpegts',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  processHandle.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-16384);
  });
  const diagnostics = () => redactStreamDiagnostics(stderr, sourceUrl);

  let closed = false;
  let killTimer;
  let streamController;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    onConnectionChange?.(-1);
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onAbort);
    processHandle.kill('SIGTERM');
    killTimer = setTimeout(() => processHandle.kill('SIGKILL'), 2000);
    killTimer.unref();
  };

  const finish = (error) => {
    if (closed) return;
    cleanup();
    if (error) streamController.error(error);
    else streamController.close();
  };

  const onAbort = () => finish();
  // Output inactivity is separate from the hub's no-viewer shutdown grace period.
  // idleMs <= 0 explicitly disables this startup/playback watchdog.
  const idleTimer =
    idleMs > 0
      ? setTimeout(() => finish(new Error('Stream timed out')), idleMs)
      : null;
  if (idleTimer) idleTimer.unref?.();

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      processHandle.stdout.on('data', (chunk) => {
        if (closed) return;
        idleTimer?.refresh?.();
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize || 0) <= 0) processHandle.stdout.pause();
      });
      processHandle.on('error', () =>
        finish(new Error('Unable to start FFmpeg. Check server installation.')),
      );
      processHandle.on('close', (code) => {
        clearTimeout(killTimer);
        if (!closed && code !== 0) {
          console.error(logPrefix, 'FFmpeg exit', code, diagnostics() || 'No diagnostic output');
        }
        finish(
          code && code !== 0
            ? new Error('Stream unavailable. Check the server stream configuration.')
            : undefined,
        );
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    },
    pull() {
      processHandle.stdout.resume();
    },
    cancel() {
      cleanup();
    },
  }, {
    // Keep the pipe lean so remuxed H.265 reaches WASM with less queue-buffer delay.
    highWaterMark: 256 * 1024,
    size: (chunk) => chunk.byteLength,
  });

  // Callers need FFmpeg's own words to explain a failed start (403 too many users,
  // "unspecified size", refused connection) instead of a generic "no video" message.
  stream.diagnostics = diagnostics;

  onConnectionChange?.(1);
  return stream;
}
