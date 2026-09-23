import { preloadHevcPlayer } from "./load-script.js";
import type {
  CreateHevcPlayerOptions,
  HevcPlayer,
  HevcPlayerEvent,
  HevcPlayerStats,
  LibmediaPlayer,
} from "./types.js";

/** libmedia / FFmpeg codec ids we ship WASM for. */
export const H264_CODEC_ID = 27;
export const HEVC_CODEC_ID = 173;

export const DEFAULT_WASM_BASE_URL = "/wasm/";
/** @deprecated Use DEFAULT_WASM_BASE_URL + hevc-simd.wasm */
export const DEFAULT_WASM_URL = "/wasm/hevc-simd.wasm";

const DECODER_FILES: Record<number, string> = {
  [H264_CODEC_ID]: "h264-simd.wasm",
  [HEVC_CODEC_ID]: "hevc-simd.wasm",
};

const EVENT_MAP: Record<HevcPlayerEvent, string> = {
  playing: "firstVideoRendered",
  error: "error",
  ended: "ended",
  timeout: "timeout",
};

function joinWasmUrl(base: string, file: string) {
  return base.endsWith("/") ? base + file : `${base}/${file}`;
}

/**
 * Create a player, load the stream, and start video.
 * Software WASM is the default. Supports H.264 and H.265.
 */
export async function createHevcPlayer(
  container: HTMLDivElement,
  options: CreateHevcPlayerOptions,
): Promise<HevcPlayer> {
  if (!container) throw new Error("createHevcPlayer needs a DOM container.");
  if (!options?.url) throw new Error("createHevcPlayer needs a stream URL.");
  // WHEP returns SDP and negotiates native WebRTC codecs; it is not a media file.
  const pathname = options.url.split(/[?#]/, 1)[0];
  if (/\/whep\/?$/i.test(pathname)) {
    throw new Error(
      "WHEP cannot be decoded directly by this WASM player. Use the HTTP MPEG-TS gateway for the same MediaMTX stream.",
    );
  }

  const mode = options.mode ?? "software";
  const live = options.live ?? true;
  const wasmBaseUrl = options.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL;
  const preferNative = mode === "auto";

  await preloadHevcPlayer(options.scriptUrl);
  if (!window.AVPlayer) throw new Error("AVPlayer failed to load.");

  const inner: LibmediaPlayer = new window.AVPlayer({
    container,
    // MSE would hand the codec to the browser; keep WASM path available for HEVC.
    enableWebCodecs: preferNative,
    enableHardware: preferNative,
    checkUseMSE: () => false,
    enableWorker: true,
    enableWebGPU: false,
    lowLatency: live,
    // Short live buffer: targets ~sub-second glass-to-glass with RTSP remux.
    enableJitterBuffer: true,
    jitterBufferMin: live ? 0.05 : 0.2,
    jitterBufferMax: live ? 0.35 : 1,
    getWasm: (type: string, codec: number) => {
      if (type !== "decoder") {
        throw new Error(`Decoder resource unavailable: ${type}.`);
      }
      // Legacy single-file override still maps to HEVC only.
      if (codec === HEVC_CODEC_ID && options.wasmUrl) return options.wasmUrl;
      const file = DECODER_FILES[codec];
      if (!file) {
        throw new Error(
          `Unsupported video codec ${codec}. This player includes H.264 and H.265 WASM decoders only.`,
        );
      }
      return joinWasmUrl(wasmBaseUrl, file);
    },
  });

  attach(inner, "playing", options.onPlaying);
  attach(inner, "error", options.onError);
  attach(inner, "ended", options.onEnded);
  attach(inner, "timeout", options.onTimeout);

  const player: HevcPlayer = {
    destroy: () => inner.destroy(),
    on: (event, callback) => attach(inner, event, callback),
    stats: () => readStats(inner),
  };

  try {
    // Worker fetches cannot resolve relative URLs against the document location.
    await inner.load(new URL(options.url, document.baseURI).href, {
      isLive: live,
      ext: options.ext ?? (live ? "ts" : "mp4"),
      maxProbeDuration: live ? 1 : 2,
    });
    await inner.play({ audio: options.audio ?? false, video: true });
  } catch (error) {
    await inner.destroy();
    throw error;
  }

  return player;
}

/** Alias that makes multi-codec intent obvious for new callers. */
export const createStreamPlayer = createHevcPlayer;

function attach(player: LibmediaPlayer, event: HevcPlayerEvent, callback?: () => void) {
  if (!callback) return;
  player.on(EVENT_MAP[event], callback);
}

function readStats(player: LibmediaPlayer): HevcPlayerStats {
  try {
    const raw = player.getStats();
    return {
      fps: raw.videoRenderFramerate || 0,
      width: raw.width || 0,
      height: raw.height || 0,
      dropped: raw.videoFrameDropCount || 0,
      frames: Number(raw.videoFrameDecodeCount || 0),
      bitrate: raw.videoBitrate || 0,
    };
  } catch {
    return { fps: 0, width: 0, height: 0, dropped: 0, frames: 0, bitrate: 0 };
  }
}
