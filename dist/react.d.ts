import { type CSSProperties } from "react";
import type { HevcDecodeMode, HevcPlayer } from "./types.js";
type HevcPlayerProps = {
    url: string;
    live?: boolean;
    mode?: HevcDecodeMode;
    audio?: boolean;
    muted?: boolean;
    volume?: number;
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
 * The host page must still serve /vendor and /wasm (see copy-assets).
 */
export declare function HevcPlayerView({ url, live, mode, audio, muted, volume, onReady, className, style, onPlaying, onError, onEnded, onTimeout, }: HevcPlayerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=react.d.ts.map