import { spawn } from 'node:child_process';
import { resolveStreamSource, streamStatus, StreamConfigurationError, redactStreamDiagnostics } from '../../lib/stream-source.mjs';
import { isSameOriginRequest, readRtspRequest, rtspSessions } from '../../lib/rtsp-sessions.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & { hevcConnections?: number };
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return new Response('Forbidden', {status:403});
  try {
    const url = await readRtspRequest(request);
    const ticket = rtspSessions.add(url);
    return Response.json({streamUrl: `/api/stream?ticket=${ticket}`}, {status:201, headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    if (error instanceof StreamConfigurationError) return Response.json({error: error.message}, {status:error.status, headers:{'Cache-Control':'no-store'}});
    return Response.json({error:'Unable to create stream.'}, {status:500});
  }
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const source = params.get('source') || streamStatus().defaultSource;
  if (!isSameOriginRequest(request)) return new Response('Forbidden', {status:403});
  if ((state.hevcConnections || 0) >= 4) return new Response('Preview connection limit reached.', {status:429});
  let resolved: ReturnType<typeof resolveStreamSource>;
  try {
    if (params.has('ticket')) {
      const url = rtspSessions.take(params.get('ticket'));
      if (!url) return new Response('Stream request expired. Start the stream again.', {status:410});
      resolved = resolveStreamSource('camera', {...process.env, CAMERA_RTSP_URL:url});
    } else {
      resolved = resolveStreamSource(source);
    }
  } catch (error) {
    if (error instanceof StreamConfigurationError) return new Response(error.message, {status: error.status});
    throw error;
  }
  state.hevcConnections = (state.hevcConnections || 0) + 1;
  const processHandle = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner','-loglevel','error',...resolved.input,'-map','0:v:0','-map','0:a:0?',
    '-c:v','copy','-c:a','aac','-b:a','96k','-ar','48000','-ac','2',
    '-mpegts_flags','+resend_headers','-muxdelay','0','-muxpreload','0','-f','mpegts','pipe:1'
  ], {stdio:['ignore','pipe','pipe']});
  let stderr = '';
  // Accumulate before redacting, since credentials can span stderr chunks.
  processHandle.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16384); });
  const diagnostics = () => redactStreamDiagnostics(stderr, resolved.url);
  let closed = false;
  let outputPaused = false;
  let killTimer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    state.hevcConnections = Math.max(0,(state.hevcConnections || 1)-1);
    clearTimeout(idleTimer);
    request.signal.removeEventListener('abort', onAbort);
    processHandle.kill('SIGTERM');
    killTimer = setTimeout(() => processHandle.kill('SIGKILL'),2000);
    killTimer.unref();
  };
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const finish = (error?: Error) => {
    if (closed) return;
    cleanup();
    if (error) streamController.error(error); else streamController.close();
  };
  const onAbort = () => finish();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshIdleTimer = () => {
    if (idleTimer) idleTimer.refresh();
    else idleTimer = setTimeout(() => finish(new Error('Stream timed out')),20000);
    idleTimer.unref();
  };
  refreshIdleTimer();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      processHandle.stdout.on('data',(chunk: Buffer) => {
        if (closed) return;
        refreshIdleTimer();
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize || 0) <= 0) {
          // A full response queue is client backpressure, not an offline camera.
          // Restart the source watchdog when the browser requests more bytes.
          outputPaused = true;
          clearTimeout(idleTimer);
          idleTimer = undefined;
          processHandle.stdout.pause();
        }
      });
      processHandle.on('error',() => finish(new Error('Unable to start FFmpeg. Check server installation.')));
      processHandle.on('close',(code) => {
        clearTimeout(killTimer);
        if (!closed && code !== 0) console.error('[hevc-gateway] FFmpeg exit', code, diagnostics() || 'No diagnostic output');
        finish(code && code !== 0 ? new Error('Stream unavailable. Check the server stream configuration.') : undefined);
      });
      request.signal.addEventListener('abort',onAbort,{once:true});
      if (request.signal.aborted) onAbort();
    },
    pull() {
      if (closed) return;
      if (outputPaused) {
        outputPaused = false;
        refreshIdleTimer();
      }
      processHandle.stdout.resume();
    },
    cancel() { cleanup(); }
  }, {highWaterMark: 1024 * 1024, size: chunk => chunk.byteLength});
  return new Response(stream,{headers:{'Content-Type':'video/mp2t','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
