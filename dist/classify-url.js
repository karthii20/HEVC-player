/**
 * Turn a MediaMTX viewer / path URL into the WHEP signaling endpoint.
 * https://host/uuid  →  https://host/uuid/whep
 * Kept for optional WebRTC (native decode). Prefer RTSP remux for H.265 on all browsers.
 */
export function toWhepUrl(input) {
    const parsed = new URL(input.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("WHEP requires an http:// or https:// MediaMTX URL.");
    }
    let pathname = mediaMtxStreamPath(parsed.pathname);
    if (!pathname.endsWith("/"))
        pathname += "/";
    pathname += "whep";
    parsed.pathname = pathname;
    parsed.hash = "";
    return parsed.toString();
}
/**
 * MediaMTX path without /whep or /whip suffix.
 * /cam/live/whep → /cam/live
 * /uuid/ → /uuid
 */
export function mediaMtxStreamPath(pathname) {
    let path = pathname || "/";
    path = path.replace(/\/(?:whep|whip)\/?$/i, "");
    if (!path.startsWith("/"))
        path = `/${path}`;
    if (path.length > 1 && path.endsWith("/"))
        path = path.slice(0, -1);
    return path || "/";
}
/**
 * Derive the MediaMTX RTSP read URL from an HTTPS viewer / WHEP page.
 * https://host/uuid → rtsp://host:8554/uuid
 *
 * This is the path that enables H.265 + low latency in every browser:
 * RTSP → FFmpeg remux (copy) → MPEG-TS → WASM. Stock WebRTC cannot do that.
 */
export function toMediaMtxRtspUrl(input, { port = 8554 } = {}) {
    const parsed = new URL(input.trim());
    if (!["http:", "https:", "rtsp:", "rtsps:"].includes(parsed.protocol)) {
        throw new Error("Expected an http(s) MediaMTX viewer URL or an rtsp(s) URL.");
    }
    if (["rtsp:", "rtsps:"].includes(parsed.protocol)) {
        return parsed.toString();
    }
    const streamPath = mediaMtxStreamPath(parsed.pathname);
    if (streamPath === "/") {
        throw new Error("MediaMTX viewer URL must include a stream path.");
    }
    const rtspPort = Number.isFinite(port) && port > 0 ? port : 8554;
    // MediaMTX/FFmpeg often break on localhost → ::1; prefer IPv4 loopback.
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    // URL keeps credentials percent-encoded already; encoding again turns %40 into %2540.
    const auth = parsed.username || parsed.password
        ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
        : "";
    return `rtsp://${auth}${host}:${rtspPort}${streamPath}${parsed.search}`;
}
/** True when the URL looks like a MediaMTX path page, not an HLS playlist file. */
export function isMediaMtxViewerUrl(input) {
    try {
        const parsed = new URL(input.trim());
        if (!["http:", "https:"].includes(parsed.protocol))
            return false;
        if (/\.m3u8$/i.test(parsed.pathname))
            return false;
        if (/\/(?:whep|whip)\/?$/i.test(parsed.pathname))
            return true;
        // Path with no file extension (MediaMTX publishes /<path>/ as a WebRTC reader page).
        const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
        return last.length > 0 && !last.includes(".");
    }
    catch {
        return false;
    }
}
/** Formats FFmpeg can pull over HTTP and remux without transcoding. */
const PLAYLIST_PATH = /\.(?:m3u8|mpd|ts|m4s|mp4|flv)$/i;
export function isRemuxablePasteUrl(input) {
    try {
        const parsed = new URL(input.trim());
        if (["rtsp:", "rtsps:", "srt:", "rtmp:", "rtmps:"].includes(parsed.protocol))
            return true;
        if (["http:", "https:"].includes(parsed.protocol) && PLAYLIST_PATH.test(parsed.pathname)) {
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
/**
 * OvenMediaEngine signals WebRTC over WebSockets and serves LLHLS on the same port and
 * path: ws://host:3333/app/stream → http://host:3333/app/stream/llhls.m3u8
 * LLHLS is the form the remux gateway can read, which is what gives H.265 everywhere.
 */
export function toOvenLlHlsUrl(input) {
    const parsed = new URL(input.trim());
    const secure = ["wss:", "https:"].includes(parsed.protocol);
    if (!["ws:", "wss:", "http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Expected an OvenMediaEngine ws(s) or http(s) URL.");
    }
    const path = mediaMtxStreamPath(parsed.pathname);
    if (path === "/")
        throw new Error("OvenMediaEngine URL must include /<app>/<stream>.");
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    const port = parsed.port || (secure ? "3334" : "3333");
    return `${secure ? "https" : "http"}://${host}:${port}${path}/llhls.m3u8${parsed.search}`;
}
/**
 * OvenMediaEngine's default signaling/LLHLS ports. MediaMTX uses 8889/8888 instead, so
 * the port is what tells the two player-page URLs apart.
 */
const OVEN_PORTS = new Set(["3333", "3334"]);
export function isOvenMediaEngineUrl(input) {
    try {
        const parsed = new URL(input.trim());
        if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol))
            return false;
        return OVEN_PORTS.has(parsed.port);
    }
    catch {
        return false;
    }
}
/** WebRTC signaling URLs carry no media, so they always need a derived read URL. */
export function isWebSocketSignalingUrl(input) {
    try {
        return ["ws:", "wss:"].includes(new URL(input.trim()).protocol);
    }
    catch {
        return false;
    }
}
/**
 * Decide how to play a pasted URL.
 * Default for MediaMTX HTTPS path pages: derive RTSP and remux (H.265 + low latency, all browsers).
 * Set preferWhep for native WebRTC when that is acceptable.
 */
export function classifyPasteUrl(input, options = {}) {
    const url = input.trim();
    const { preferWhep = false, rtspPort = 8554 } = options;
    if (isRemuxablePasteUrl(url))
        return { mode: "remux", sourceUrl: url };
    if (isWebSocketSignalingUrl(url) || isOvenMediaEngineUrl(url)) {
        return { mode: "remux", sourceUrl: toOvenLlHlsUrl(url), derivedFromViewer: true };
    }
    if (isMediaMtxViewerUrl(url)) {
        if (preferWhep)
            return { mode: "whep", whepUrl: toWhepUrl(url) };
        return {
            mode: "remux",
            sourceUrl: toMediaMtxRtspUrl(url, { port: rtspPort }),
            derivedFromViewer: true,
        };
    }
    // Fallback: still try remux (gateway may fail with a clearer FFmpeg error).
    return { mode: "remux", sourceUrl: url };
}
//# sourceMappingURL=classify-url.js.map