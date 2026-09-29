import { preloadHevcPlayer } from "./load-script.js";
import { loadBundledAssets } from "./assets.js";
/** libmedia / FFmpeg codec ids we ship WASM for. */
export const H264_CODEC_ID = 27;
export const HEVC_CODEC_ID = 173;
export const AAC_CODEC_ID = 86018;
/** @deprecated Legacy public-folder path. Omit wasmBaseUrl to use bundled decoders. */
export const DEFAULT_WASM_BASE_URL = "/wasm/";
/** @deprecated Legacy public-folder path. Omit wasmUrl to use the bundled decoder. */
export const DEFAULT_WASM_URL = "/wasm/hevc-simd.wasm";
const DECODER_FILES = {
    [H264_CODEC_ID]: "h264-simd.wasm",
    [HEVC_CODEC_ID]: "hevc-simd.wasm",
    [AAC_CODEC_ID]: "aac-simd.wasm",
};
const EVENT_MAP = {
    playing: "firstVideoRendered",
    error: "error",
    ended: "ended",
    timeout: "timeout",
};
function joinWasmUrl(base, file) {
    return base.endsWith("/") ? base + file : `${base}/${file}`;
}
/**
 * Create a player, load the stream, and start video.
 * Software WASM is the default. Supports H.264 and H.265.
 */
export async function createHevcPlayer(container, options) {
    if (!container)
        throw new Error("createHevcPlayer needs a DOM container.");
    if (!options?.url)
        throw new Error("createHevcPlayer needs a stream URL.");
    const signal = options.signal;
    throwIfAborted(signal);
    // WHEP returns SDP and negotiates native WebRTC codecs; it is not a media file.
    const pathname = options.url.split(/[?#]/, 1)[0];
    if (/\/whep\/?$/i.test(pathname)) {
        throw new Error("WHEP cannot be decoded directly by this WASM player. Use the HTTP MPEG-TS gateway for the same MediaMTX stream.");
    }
    const mode = options.mode ?? "software";
    const live = options.live ?? true;
    const bundledAssets = options.wasmBaseUrl === undefined
        ? await abortable(loadBundledAssets(), signal)
        : undefined;
    const wasmUrl = (file) => options.wasmBaseUrl === undefined
        ? bundledAssets.wasmUrls[file]
        : joinWasmUrl(options.wasmBaseUrl, file);
    const preferNative = mode === "auto";
    const audio = options.audio ?? true;
    let muted = options.muted ?? true;
    let volume = checkedVolume(options.volume ?? 1);
    let audioChange = 0;
    await abortable(preloadHevcPlayer(options.scriptUrl), signal);
    throwIfAborted(signal);
    if (!window.AVPlayer)
        throw new Error("AVPlayer failed to load.");
    const initialWidth = container.clientWidth;
    const initialHeight = container.clientHeight;
    const inner = new window.AVPlayer({
        container,
        // MSE would hand the codec to the browser; keep WASM path available for HEVC.
        enableWebCodecs: preferNative,
        enableHardware: preferNative,
        checkUseMSE: () => false,
        enableWorker: true,
        enableWebGPU: false,
        lowLatency: live,
        // Leave room for camera/network jitter instead of repeatedly starving decode.
        enableJitterBuffer: true,
        jitterBufferMin: live ? 0.5 : 0.2,
        jitterBufferMax: live ? 2 : 1,
        getWasm: (type, codec) => {
            if (type === "resampler")
                return wasmUrl("resample-simd.wasm");
            if (type === "stretchpitcher")
                return wasmUrl("stretchpitch-simd.wasm");
            if (type !== "decoder") {
                throw new Error(`Decoder resource unavailable: ${type}.`);
            }
            // Legacy single-file override still maps to HEVC only.
            if (codec === HEVC_CODEC_ID && options.wasmUrl)
                return options.wasmUrl;
            const file = DECODER_FILES[codec];
            if (!file) {
                throw new Error(`Unsupported codec ${codec}. Bundled decoders support H.264, H.265 and AAC. Use the gateway to convert camera audio to AAC.`);
            }
            return wasmUrl(file);
        },
    });
    let destroyed = false;
    let destruction;
    let resizeObserver;
    const destroy = () => {
        if (destruction)
            return destruction;
        destroyed = true;
        audioChange += 1;
        resizeObserver?.disconnect();
        signal?.removeEventListener("abort", onAbort);
        // Defer the call so even a synchronous exception becomes the shared promise.
        destruction = Promise.resolve().then(() => inner.destroy());
        return destruction;
    };
    const onAbort = () => { void destroy().catch(() => { }); };
    const listen = (event, callback) => {
        if (callback)
            attach(inner, event, () => {
                if (!destroyed && !signal?.aborted)
                    callback();
            });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    listen("playing", options.onPlaying);
    listen("error", options.onError);
    listen("ended", options.onEnded);
    listen("timeout", options.onTimeout);
    const player = {
        destroy,
        on: listen,
        stats: () => readStats(inner),
        isMuted: () => muted,
        getVolume: () => volume,
        setVolume: (value) => {
            if (destroyed)
                return;
            volume = checkedVolume(value);
            inner.setVolume(muted ? 0 : volume, true);
        },
        setMuted: async (value) => {
            if (destroyed)
                return;
            if (!value && !audio)
                throw new Error("Audio is disabled. Create the player with audio: true.");
            const change = ++audioChange;
            muted = value;
            inner.setVolume(muted ? 0 : volume, true);
            if (!muted) {
                try {
                    await inner.resume();
                    // libmedia returns after 100 ms even if AudioContext.resume is still
                    // pending. Allow device startup to finish before reporting a block.
                    const deadline = Date.now() + 1500;
                    while (change === audioChange && inner.isSuspended() && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 25));
                    }
                    if (change !== audioChange)
                        return;
                    if (inner.isSuspended())
                        throw new Error("Audio is blocked by the browser. Enable sound from a click or tap.");
                }
                catch (error) {
                    if (change === audioChange) {
                        muted = true;
                        inner.setVolume(0, true);
                    }
                    throw error;
                }
            }
        },
    };
    try {
        throwIfAborted(signal);
        // Worker fetches cannot resolve relative URLs against the document location.
        await abortable(inner.load(new URL(options.url, document.baseURI).href, {
            isLive: live,
            ext: options.ext ?? (live ? "ts" : "mp4"),
            maxProbeDuration: live ? 1 : 2,
        }), signal);
        throwIfAborted(signal);
        inner.setVolume(muted ? 0 : volume, true);
        await abortable(inner.play({ audio, video: true }), signal);
        throwIfAborted(signal);
        if (typeof ResizeObserver !== "undefined") {
            let previousWidth = initialWidth;
            let previousHeight = initialHeight;
            const resize = () => {
                if (destroyed)
                    return;
                const width = container.clientWidth;
                const height = container.clientHeight;
                if (width > 0 && height > 0 && (width !== previousWidth || height !== previousHeight)) {
                    previousWidth = width;
                    previousHeight = height;
                    inner.resize(width, height);
                }
            };
            // libmedia sizes its canvas at startup; CSS alone stretches that old raster.
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);
            // The renderer already sized itself during play. Reapplying the same size
            // clears its drawing buffer and can flash black while waiting for a frame.
            resize(); // Only resize if the container actually changed during startup.
        }
    }
    catch (error) {
        if (signal?.aborted) {
            // Recovery may reuse this container as soon as startup rejects. Finish the
            // old renderer's teardown first so it cannot remove the replacement canvas.
            await destroy();
            throw abortError();
        }
        await destroy();
        throw error;
    }
    return player;
}
/** Alias that makes multi-codec intent obvious for new callers. */
export const createStreamPlayer = createHevcPlayer;
function abortError() {
    return new DOMException("Playback was cancelled.", "AbortError");
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw abortError();
}
function abortable(operation, signal) {
    if (!signal)
        return operation;
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(abortError());
        };
        operation.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
        });
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted)
            onAbort();
    });
}
function checkedVolume(volume) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new RangeError("Volume must be between 0 and 1.");
    }
    return volume;
}
function attach(player, event, callback) {
    if (!callback)
        return;
    player.on(EVENT_MAP[event], callback);
}
function readStats(player) {
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
    }
    catch {
        return { fps: 0, width: 0, height: 0, dropped: 0, frames: 0, bitrate: 0 };
    }
}
//# sourceMappingURL=create-player.js.map