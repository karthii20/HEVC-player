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
  /** Call setMuted(false) directly from a click/tap to unlock browser audio. */
  setMuted: (muted: boolean) => Promise<void>;
  isMuted: () => boolean;
  /** Playback gain from 0 to 1. Changing volume does not unmute the player. */
  setVolume: (volume: number) => void;
  getVolume: () => number;
};

export type CreateHevcPlayerOptions = {
  /** HTTP URL of an MPEG-TS or MP4 H.264 / H.265 stream. RTSP and WHEP need a media gateway. */
  url: string;
  /** Cancel pending startup or stop this player. Cancellation rejects startup with AbortError. */
  signal?: AbortSignal;
  /** Live streams skip seeking and keep a short jitter buffer. Default true. */
  live?: boolean;
  /**
   * software (default) never asks the GPU.
   * auto uses WebCodecs when present, then WASM.
   */
  mode?: HevcDecodeMode;
  /** Optional hosted avplayer.js with adjacent worker chunks. Defaults to the bundled player. */
  scriptUrl?: string;
  /**
   * Optional hosted directory containing video/audio decoders and audio processing WASM.
   * Omit to use the decoders included in this package, with no public-folder setup.
   */
  wasmBaseUrl?: string;
  /** @deprecated Prefer wasmBaseUrl. Still accepted as an override for HEVC only. */
  wasmUrl?: string;
  /** File extension when the URL has none. Default ts for live, mp4 otherwise. */
  ext?: string;
  /** Decode synchronized audio when present. Default true; false is video-only. */
  audio?: boolean;
  /** Start silently for autoplay / camera grids. Default true. */
  muted?: boolean;
  /** Initial playback gain from 0 to 1. Default 1. */
  volume?: number;
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
  setVolume: (volume: number, force?: boolean) => void;
  resume: () => Promise<void>;
  isSuspended: () => boolean;
  resize: (width: number, height: number) => void;
};

declare global {
  interface Window {
    AVPlayer?: new (options: object) => LibmediaPlayer;
  }
}

export {};
