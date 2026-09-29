"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { createHevcPlayer } from "./create-player.js";
import { startLiveStreamPlayer } from "./live-player.js";
/**
 * Drop-in React wrapper around createHevcPlayer.
 * Player, worker chunks and WASM decoders are included automatically.
 */
export function HevcPlayerView({ url, resolveUrl, onStatus, live = true, mode = "software", audio = true, muted = true, volume = 1, scriptUrl, wasmBaseUrl, wasmUrl, onReady, className, style, onPlaying, onError, onEnded, onTimeout, }) {
    const container = useRef(null);
    const currentPlayer = useRef(null);
    const teardown = useRef(Promise.resolve());
    const audioSettings = useRef({ muted, volume });
    audioSettings.current = { muted, volume };
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onPlayingRef = useRef(onPlaying);
    const onErrorRef = useRef(onError);
    const onEndedRef = useRef(onEnded);
    const onTimeoutRef = useRef(onTimeout);
    onPlayingRef.current = onPlaying;
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;
    onTimeoutRef.current = onTimeout;
    const onStatusRef = useRef(onStatus);
    onStatusRef.current = onStatus;
    useEffect(() => {
        const element = container.current;
        if (!element || (!url && !resolveUrl))
            return;
        let cancelled = false;
        let instance = null;
        const abort = new AbortController();
        const previousTeardown = teardown.current;
        const settings = {
            mode,
            audio,
            scriptUrl,
            wasmBaseUrl,
            wasmUrl,
            muted: audioSettings.current.muted,
            volume: audioSettings.current.volume,
            onPlaying: () => { if (!cancelled)
                onPlayingRef.current?.(); },
            onError: () => { if (!cancelled)
                onErrorRef.current?.(); },
            onEnded: () => { if (!cancelled)
                onEndedRef.current?.(); },
            onTimeout: () => { if (!cancelled)
                onTimeoutRef.current?.(); },
        };
        const started = previousTeardown.then(async () => {
            if (cancelled)
                return;
            const player = resolveUrl && live
                ? (() => {
                    const player = startLiveStreamPlayer(element, {
                        ...settings,
                        resolveUrl,
                        onError: (message) => { if (message && !cancelled)
                            onErrorRef.current?.(); },
                        onStatus: (status, delay) => { if (!cancelled)
                            onStatusRef.current?.(status, delay); },
                    });
                    player.on("ended", settings.onEnded);
                    player.on("timeout", settings.onTimeout);
                    return player;
                })()
                : await createHevcPlayer(element, { ...settings, url, live, signal: abort.signal });
            if (cancelled) {
                await player.destroy();
                return;
            }
            instance = player;
            currentPlayer.current = player;
            player.setVolume(audioSettings.current.volume);
            void player.setMuted(audioSettings.current.muted).catch(() => {
                if (currentPlayer.current === player)
                    onErrorRef.current?.();
            });
            onReadyRef.current?.(player);
        })
            .catch(() => {
            if (!cancelled)
                onErrorRef.current?.();
        });
        return () => {
            cancelled = true;
            abort.abort();
            if (currentPlayer.current === instance)
                currentPlayer.current = null;
            // Source/prop changes and Strict Mode must finish removing the old canvas
            // before a new decoder is allowed to use this same container.
            teardown.current = Promise.allSettled([started, instance?.destroy()]).then(() => { });
        };
    }, [url, resolveUrl, live, mode, audio, scriptUrl, wasmBaseUrl, wasmUrl]);
    useEffect(() => {
        const player = currentPlayer.current;
        if (!player)
            return;
        try {
            player.setVolume(volume);
            void player.setMuted(muted).catch(() => {
                if (currentPlayer.current === player)
                    onErrorRef.current?.();
            });
        }
        catch {
            onErrorRef.current?.();
        }
    }, [muted, volume]);
    return _jsx("div", { ref: container, className: className, style: style });
}
//# sourceMappingURL=react.js.map