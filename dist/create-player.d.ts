import type { CreateHevcPlayerOptions, HevcPlayer } from "./types.js";
/** libmedia / FFmpeg codec ids we ship WASM for. */
export declare const H264_CODEC_ID = 27;
export declare const HEVC_CODEC_ID = 173;
export declare const AAC_CODEC_ID = 86018;
export declare const DEFAULT_WASM_BASE_URL = "/wasm/";
/** @deprecated Use DEFAULT_WASM_BASE_URL + hevc-simd.wasm */
export declare const DEFAULT_WASM_URL = "/wasm/hevc-simd.wasm";
/**
 * Create a player, load the stream, and start video.
 * Software WASM is the default. Supports H.264 and H.265.
 */
export declare function createHevcPlayer(container: HTMLDivElement, options: CreateHevcPlayerOptions): Promise<HevcPlayer>;
/** Alias that makes multi-codec intent obvious for new callers. */
export declare const createStreamPlayer: typeof createHevcPlayer;
//# sourceMappingURL=create-player.d.ts.map