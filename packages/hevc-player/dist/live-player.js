import { createHevcPlayer } from "./create-player.js";
import { startLivePlayback } from "./live-playback.js";
import { createFrameHold } from "./frame-hold.js";
const emptyStats = () => ({ fps: 0, width: 0, height: 0, dropped: 0, frames: 0, bitrate: 0 });
/**
 * Start a live session with automatic ticket renewal, capped retry backoff and a
 * decoded-frame watchdog. The handle is available immediately, including Stop
 * while connecting. Use createHevcPlayer for single-attempt or recorded playback.
 */
export function startLiveStreamPlayer(container, options) {
    if (!container || typeof options?.resolveUrl !== "function") {
        throw new Error("startLiveStreamPlayer needs a container and resolveUrl callback.");
    }
    let active = null;
    let stopped = false;
    let muted = options.muted ?? true;
    let volume = checkVolume(options.volume ?? 1);
    let audioChange = 0;
    const frameHold = createFrameHold(container);
    const listeners = new Map();
    const emit = (event) => {
        if (!stopped)
            listeners.get(event)?.forEach((callback) => callback());
    };
    const report = (message) => {
        if (stopped)
            return;
        options.onError?.(message);
        if (message)
            emit("error");
    };
    const session = startLivePlayback({
        async connect({ signal, onPlaying, onInterrupted }) {
            const url = await options.resolveUrl(signal);
            if (signal.aborted)
                throw new DOMException("Playback was cancelled.", "AbortError");
            const picture = frameHold.beginAttempt();
            // Register before createHevcPlayer's abort listener destroys its canvas.
            // This also covers the decoded-frame watchdog, not just error/EOF events.
            signal.addEventListener("abort", picture.freeze, { once: true });
            return createHevcPlayer(container, {
                ...options,
                url,
                live: true,
                signal,
                muted,
                volume,
                onPlaying() {
                    picture.rendered();
                    onPlaying();
                    if (stopped)
                        return;
                    options.onPlaying?.();
                    emit("playing");
                },
                onError: onInterrupted,
                onEnded() { onInterrupted(); emit("ended"); },
                onTimeout() { onInterrupted(); emit("timeout"); },
            });
        },
        onState(status, delay) { if (!stopped)
            options.onStatus?.(status, delay); },
        onPlayer(player) {
            active = player;
            if (!player || stopped)
                return;
            player.setVolume(volume);
            // Apply preferences changed during startup; sound activation errors must
            // not restart an otherwise healthy video stream.
            void player.setMuted(muted).catch((error) => {
                if (active === player)
                    report(error instanceof Error ? error.message : "Unable to enable sound.");
            });
        },
        onError: report,
        onFatal() { if (!stopped)
            options.onStatus?.("Error"); },
    });
    return {
        async destroy() {
            stopped = true;
            frameHold.destroy();
            audioChange++;
            listeners.clear();
            await session.stop();
        },
        on(event, callback) {
            if (stopped)
                return;
            if (!listeners.has(event))
                listeners.set(event, new Set());
            listeners.get(event).add(callback);
        },
        stats: () => active?.stats() ?? emptyStats(),
        isMuted: () => active?.isMuted() ?? muted,
        getVolume: () => volume,
        setVolume(value) {
            volume = checkVolume(value);
            active?.setVolume(volume);
        },
        async setMuted(value) {
            if (stopped)
                return;
            if (!value && options.audio === false)
                throw new Error("Audio is disabled. Create the player with audio: true.");
            const change = ++audioChange;
            muted = value;
            const player = active;
            try {
                await player?.setMuted(value);
            }
            catch (error) {
                if (active === player && change === audioChange)
                    muted = player.isMuted();
                throw error;
            }
        },
    };
}
function checkVolume(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new RangeError("Volume must be between 0 and 1.");
    return value;
}
//# sourceMappingURL=live-player.js.map