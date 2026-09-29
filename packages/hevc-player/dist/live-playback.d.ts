import type { HevcPlayer } from "./types.js";
type LivePlaybackOptions = {
    connect: (callbacks: {
        signal: AbortSignal;
        onPlaying: () => void;
        onInterrupted: () => void;
    }) => Promise<HevcPlayer>;
    onState?: (state: string, retryInMs?: number) => void;
    onPlayer?: (player: HevcPlayer | null) => void;
    onError?: (message: string) => void;
    onFatal?: () => void;
    retryMinMs?: number;
    retryMaxMs?: number;
    startupMs?: number;
    stallMs?: number;
    pollMs?: number;
    stableMs?: number;
};
/**
 * Own a live viewing session across network/decoder interruptions. Each attempt
 * calls connect again so short-lived stream tickets are never reused on retry.
 * Attempts are serialized: the old decoder is destroyed before creating another.
 */
export declare function startLivePlayback({ connect, onState, onPlayer, onError, onFatal, retryMinMs, retryMaxMs, startupMs, stallMs, pollMs, stableMs, }: LivePlaybackOptions): {
    stop(): Promise<void>;
};
export {};
//# sourceMappingURL=live-playback.d.ts.map