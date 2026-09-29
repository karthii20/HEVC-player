/**
 * Turn a MediaMTX viewer / path URL into the WHEP signaling endpoint.
 * https://host/uuid  →  https://host/uuid/whep
 * Kept for optional WebRTC (native decode). Prefer RTSP remux for H.265 on all browsers.
 */
export declare function toWhepUrl(input: string): string;
/**
 * MediaMTX path without /whep or /whip suffix.
 * /cam/live/whep → /cam/live
 * /uuid/ → /uuid
 */
export declare function mediaMtxStreamPath(pathname: string): string;
/**
 * Derive the MediaMTX RTSP read URL from an HTTPS viewer / WHEP page.
 * https://host/uuid → rtsp://host:8554/uuid
 *
 * This is the path that enables H.265 + low latency in every browser:
 * RTSP → FFmpeg remux (copy) → MPEG-TS → WASM. Stock WebRTC cannot do that.
 */
export declare function toMediaMtxRtspUrl(input: string, { port }?: {
    port?: number;
}): string;
/** True when the URL looks like a MediaMTX path page, not an HLS playlist file. */
export declare function isMediaMtxViewerUrl(input: string): boolean;
export declare function isRemuxablePasteUrl(input: string): boolean;
/**
 * OvenMediaEngine signals WebRTC over WebSockets and serves LLHLS on the same port and
 * path: ws://host:3333/app/stream → http://host:3333/app/stream/llhls.m3u8
 * LLHLS is the form the remux gateway can read, which is what gives H.265 everywhere.
 */
export declare function toOvenLlHlsUrl(input: string): string;
export declare function isOvenMediaEngineUrl(input: string): boolean;
/** WebRTC signaling URLs carry no media, so they always need a derived read URL. */
export declare function isWebSocketSignalingUrl(input: string): boolean;
export type ClassifyPasteUrlOptions = {
    /**
     * Use native WebRTC instead of RTSP remux.
     * Only use when the publisher is H.264 (or the browser has native HEVC WebRTC).
     * Default false: H.265 works in all browsers via WASM remux.
     */
    preferWhep?: boolean;
    /** MediaMTX RTSP listen port when deriving from an HTTPS viewer URL. Default 8554. */
    rtspPort?: number;
};
export type PastePlayback = {
    mode: "whep";
    whepUrl: string;
} | {
    mode: "remux";
    sourceUrl: string;
    derivedFromViewer?: boolean;
};
/**
 * Decide how to play a pasted URL.
 * Default for MediaMTX HTTPS path pages: derive RTSP and remux (H.265 + low latency, all browsers).
 * Set preferWhep for native WebRTC when that is acceptable.
 */
export declare function classifyPasteUrl(input: string, options?: ClassifyPasteUrlOptions): PastePlayback;
//# sourceMappingURL=classify-url.d.ts.map