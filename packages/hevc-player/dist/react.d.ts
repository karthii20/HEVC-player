import { type CSSProperties } from "react";
import type { HevcDecodeMode, HevcPlayer } from "./types.js";
type HevcPlayerProps = {
    url?: string;
    /** Renew a live stream ticket on every reconnect. Keep this callback stable with useCallback. */
    resolveUrl?: (signal: AbortSignal) => Promise<string>;
    onStatus?: (status: string, retryInMs?: number) => void;
    live?: boolean;
    mode?: HevcDecodeMode;
    audio?: boolean;
    muted?: boolean;
    volume?: number;
    /** Optional externally hosted player and decoder overrides. Bundled assets are the default. */
    scriptUrl?: string;
    wasmBaseUrl?: string;
    wasmUrl?: string;
    /** Access mute/volume controls, e.g. setMuted(false) from a button click. */
    onReady?: (player: HevcPlayer) => void;
    className?: string;
    style?: CSSProperties;
    onPlaying?: () => void;
    onError?: () => void;
    onEnded?: () => void;
    onTimeout?: () => void;
};
/**
 * Drop-in React wrapper around createHevcPlayer.
 * Player, worker chunks and WASM decoders are included automatically.
 */
export declare function HevcPlayerView({ url, resolveUrl, onStatus, live, mode, audio, muted, volume, scriptUrl, wasmBaseUrl, wasmUrl, onReady, className, style, onPlaying, onError, onEnded, onTimeout, }: HevcPlayerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=react.d.ts.map