"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { createHevcPlayer } from "./create-player.js";
/**
 * Drop-in React wrapper around createHevcPlayer.
 * The host page must still serve /vendor and /wasm (see copy-assets).
 */
export function HevcPlayerView({ url, live = true, mode = "software", className, style, onPlaying, onError, onEnded, onTimeout, }) {
    const container = useRef(null);
    const onPlayingRef = useRef(onPlaying);
    const onErrorRef = useRef(onError);
    const onEndedRef = useRef(onEnded);
    const onTimeoutRef = useRef(onTimeout);
    onPlayingRef.current = onPlaying;
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;
    onTimeoutRef.current = onTimeout;
    useEffect(() => {
        const element = container.current;
        if (!element || !url)
            return;
        let cancelled = false;
        let instance = null;
        createHevcPlayer(element, {
            url,
            live,
            mode,
            onPlaying: () => onPlayingRef.current?.(),
            onError: () => onErrorRef.current?.(),
            onEnded: () => onEndedRef.current?.(),
            onTimeout: () => onTimeoutRef.current?.(),
        })
            .then((player) => {
            if (cancelled) {
                void player.destroy();
                return;
            }
            instance = player;
        })
            .catch(() => {
            if (!cancelled)
                onErrorRef.current?.();
        });
        return () => {
            cancelled = true;
            void instance?.destroy();
        };
    }, [url, live, mode]);
    return _jsx("div", { ref: container, className: className, style: style });
}
//# sourceMappingURL=react.js.map