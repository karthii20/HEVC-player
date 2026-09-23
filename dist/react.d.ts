import { type CSSProperties } from "react";
import type { HevcDecodeMode } from "./types.js";
type HevcPlayerProps = {
    url: string;
    live?: boolean;
    mode?: HevcDecodeMode;
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
export declare function HevcPlayerView({ url, live, mode, className, style, onPlaying, onError, onEnded, onTimeout, }: HevcPlayerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=react.d.ts.map