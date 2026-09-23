/**
 * How frames are unzipped.
 *
 * software — always use the WebAssembly decoder (CPU).
 * auto — try the browser/OS decoder first, then fall back to WebAssembly.
 */
export type HevcDecodeMode = "software" | "auto";
export type HevcPlayerEvent = "playing" | "error" | "ended" | "timeout";
export type HevcPlayerStats = {
    fps: number;
    width: number;
    height: number;
    dropped: number;
    frames: number;
    bitrate: number;
};
export type HevcPlayer = {
    /** Stop playback and free decoder workers. */
    destroy: () => Promise<void>;
    on: (event: HevcPlayerEvent, callback: () => void) => void;
    stats: () => HevcPlayerStats;
};
export type CreateHevcPlayerOptions = {
    /** HTTP URL of an MPEG-TS or MP4 H.264 / H.265 stream. RTSP and WHEP need a media gateway. */
    url: string;
    /** Live streams skip seeking and keep a short jitter buffer. Default true. */
    live?: boolean;
    /**
     * software (default) never asks the GPU.
     * auto uses WebCodecs when present, then WASM.
     */
    mode?: HevcDecodeMode;
    /** Public URL of avplayer.js plus its worker chunks. Default /vendor/avplayer.js */
    scriptUrl?: string;
    /**
     * Directory that contains h264-simd.wasm and hevc-simd.wasm.
     * Default /wasm/
     */
    wasmBaseUrl?: string;
    /** @deprecated Prefer wasmBaseUrl. Still accepted as an override for HEVC only. */
    wasmUrl?: string;
    /** File extension when the URL has none. Default ts for live, mp4 otherwise. */
    ext?: string;
    audio?: boolean;
    onPlaying?: () => void;
    onError?: () => void;
    onEnded?: () => void;
    onTimeout?: () => void;
};
export type LibmediaStats = {
    width: number;
    height: number;
    videoRenderFramerate: number;
    videoFrameDropCount: number;
    videoFrameDecodeCount: bigint;
    videoBitrate: number;
};
export type LibmediaPlayer = {
    load: (url: string, options: object) => Promise<void>;
    play: (options: object) => Promise<void>;
    destroy: () => Promise<void>;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    getStats: () => LibmediaStats;
};
declare global {
    interface Window {
        AVPlayer?: new (options: object) => LibmediaPlayer;
    }
}
export {};
//# sourceMappingURL=types.d.ts.map