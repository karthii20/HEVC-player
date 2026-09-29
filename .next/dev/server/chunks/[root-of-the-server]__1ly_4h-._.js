module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:child_process [external] (node:child_process, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:child_process", () => require("node:child_process"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[project]/app/api/stream/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "dynamic",
    ()=>dynamic,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:child_process [external] (node:child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
;
;
const runtime = 'nodejs';
const dynamic = 'force-dynamic';
const state = globalThis;
async function GET(request) {
    const source = new URL(request.url).searchParams.get('source') || (process.env.CAMERA_RTSP_URL ? 'camera' : 'demo');
    if (![
        'demo',
        'camera'
    ].includes(source)) return new Response('Unknown source', {
        status: 400
    });
    if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', {
        status: 403
    });
    const camera = process.env.CAMERA_RTSP_URL;
    if (source === 'camera' && !camera) return new Response('Set CAMERA_RTSP_URL on the server first.', {
        status: 503
    });
    if ((state.hevcConnections || 0) >= 4) return new Response('Preview connection limit reached.', {
        status: 429
    });
    state.hevcConnections = (state.hevcConnections || 0) + 1;
    const input = source === 'demo' ? [
        '-re',
        '-stream_loop',
        '-1',
        '-i',
        __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["default"].join(process.cwd(), 'public/media/demo.mp4')
    ] : [
        '-rtsp_transport',
        'tcp',
        '-timeout',
        '15000000',
        '-i',
        camera
    ];
    const processHandle = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["spawn"])(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        ...input,
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'copy',
        '-mpegts_flags',
        '+resend_headers',
        '-muxdelay',
        '0',
        '-muxpreload',
        '0',
        '-f',
        'mpegts',
        'pipe:1'
    ], {
        stdio: [
            'ignore',
            'pipe',
            'pipe'
        ]
    });
    let stderr = '';
    // Accumulate before redacting, since credentials can span stderr chunks.
    processHandle.stderr.on('data', (chunk)=>{
        stderr = (stderr + chunk.toString()).slice(-16384);
    });
    const diagnostics = ()=>{
        let message = stderr;
        if (camera) {
            message = message.split(camera).join('[camera URL]');
            try {
                const parsed = new URL(camera);
                for (const secret of [
                    parsed.password,
                    decodeURIComponent(parsed.password)
                ]){
                    if (secret) message = message.split(secret).join('[redacted]');
                }
            } catch  {}
        }
        return message.replace(/rtsps?:\/\/[^\s]+/gi, '[camera URL]').slice(-4000).trim();
    };
    let closed = false;
    let killTimer;
    const cleanup = ()=>{
        if (closed) return;
        closed = true;
        state.hevcConnections = Math.max(0, (state.hevcConnections || 1) - 1);
        clearTimeout(idleTimer);
        request.signal.removeEventListener('abort', onAbort);
        processHandle.kill('SIGTERM');
        killTimer = setTimeout(()=>processHandle.kill('SIGKILL'), 2000);
        killTimer.unref();
    };
    let streamController;
    const finish = (error)=>{
        if (closed) return;
        cleanup();
        if (error) streamController.error(error);
        else streamController.close();
    };
    const onAbort = ()=>finish();
    const idleTimer = setTimeout(()=>finish(new Error('Stream timed out')), 20000);
    const stream = new ReadableStream({
        start (controller) {
            streamController = controller;
            processHandle.stdout.on('data', (chunk)=>{
                if (closed) return;
                idleTimer.refresh();
                controller.enqueue(new Uint8Array(chunk));
                if ((controller.desiredSize || 0) <= 0) processHandle.stdout.pause();
            });
            processHandle.on('error', ()=>finish(new Error('Unable to start FFmpeg. Check server installation.')));
            processHandle.on('close', (code)=>{
                clearTimeout(killTimer);
                if (!closed && code !== 0) console.error('[hevc-gateway] FFmpeg exit', code, diagnostics() || 'No diagnostic output');
                finish(code && code !== 0 ? new Error('Stream unavailable. Check server camera configuration.') : undefined);
            });
            request.signal.addEventListener('abort', onAbort, {
                once: true
            });
            if (request.signal.aborted) onAbort();
        },
        pull () {
            processHandle.stdout.resume();
        },
        cancel () {
            cleanup();
        }
    }, {
        highWaterMark: 1024 * 1024,
        size: (chunk)=>chunk.byteLength
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no'
        }
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1ly_4h-._.js.map