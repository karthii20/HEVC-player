import type { CreateHevcPlayerOptions, HevcPlayer } from "./types.js";
export type StartLiveStreamPlayerOptions = Omit<CreateHevcPlayerOptions, "url" | "live" | "signal" | "onError" | "onEnded" | "onTimeout"> & {
    /** Called on every attempt. Register a fresh gateway session here. */
    resolveUrl: (signal: AbortSignal) => Promise<string>;
    onStatus?: (status: string, retryInMs?: number) => void;
    /** An empty message clears the previous interruption after recovery. */
    onError?: (message: string) => void;
};
/**
 * Start a live session with automatic ticket renewal, capped retry backoff and a
 * decoded-frame watchdog. The handle is available immediately, including Stop
 * while connecting. Use createHevcPlayer for single-attempt or recorded playback.
 */
export declare function startLiveStreamPlayer(container: HTMLDivElement, options: StartLiveStreamPlayerOptions): HevcPlayer;
//# sourceMappingURL=live-player.d.ts.map