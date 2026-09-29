/**
 * Own a live viewing session across network/decoder interruptions. Each attempt
 * calls connect again so short-lived stream tickets are never reused on retry.
 * Attempts are serialized: the old decoder is destroyed before creating another.
 */
export function startLivePlayback({ connect, onState = () => { }, onPlayer = () => { }, onError = () => { }, onFatal = () => { }, retryMinMs = 1000, retryMaxMs = 15000, startupMs = 45000, stallMs = 30000, pollMs = 1000, stableMs = 30000, }) {
    const lifetime = new AbortController();
    let failures = 0;
    async function run() {
        while (!lifetime.signal.aborted) {
            const attempt = new AbortController();
            let player;
            let playingAt = 0;
            let lastProgressAt = 0;
            let interrupted;
            let monitor;
            let fatal = false;
            const ended = new Promise((resolve) => { interrupted = resolve; });
            const interrupt = () => {
                if (attempt.signal.aborted)
                    return;
                attempt.abort();
                interrupted();
            };
            lifetime.signal.addEventListener('abort', interrupt, { once: true });
            const startup = setTimeout(interrupt, startupMs);
            onState(failures ? 'Reconnecting' : 'Connecting');
            try {
                player = await connect({
                    signal: attempt.signal,
                    onPlaying() {
                        if (attempt.signal.aborted)
                            return;
                        playingAt || (playingAt = Date.now());
                        onError('');
                        onState('Playing');
                    },
                    onInterrupted: interrupt,
                });
                clearTimeout(startup);
                if (!attempt.signal.aborted) {
                    onPlayer(player);
                    let lastFrames = player.stats().frames;
                    let lastProgress = Date.now();
                    monitor = setInterval(() => {
                        const frames = player.stats().frames;
                        if (frames !== lastFrames) {
                            lastFrames = frames;
                            lastProgress = Date.now();
                            lastProgressAt = lastProgress;
                        }
                        else if (Date.now() - lastProgress >= stallMs) {
                            interrupt();
                        }
                    }, pollMs);
                    await ended;
                }
            }
            catch (error) {
                if (!lifetime.signal.aborted && error?.retryable === false) {
                    fatal = true;
                    onError(error.message);
                }
            }
            finally {
                clearTimeout(startup);
                clearInterval(monitor);
                lifetime.signal.removeEventListener('abort', interrupt);
                interrupt();
                onPlayer(null);
                // destroy is idempotent, including when the attempt signal already tore
                // down the player. Do not allow a cleanup failure to disable recovery.
                await player?.destroy().catch(() => { });
            }
            if (lifetime.signal.aborted)
                return;
            if (fatal) {
                onFatal();
                return;
            }
            // A single rendered frame must not reset backoff for a flapping camera.
            if (playingAt && lastProgressAt - playingAt >= stableMs)
                failures = 0;
            const delay = Math.min(retryMaxMs, retryMinMs * 2 ** Math.min(failures++, 20));
            onError('Stream interrupted. Reconnecting automatically…');
            onState('Reconnecting', delay);
            await abortableDelay(delay, lifetime.signal);
        }
    }
    // Let the caller save this handle before any callback can run.
    const done = Promise.resolve().then(run);
    return {
        async stop() {
            lifetime.abort();
            await done;
        },
    };
}
function abortableDelay(ms, signal) {
    return new Promise((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted)
            finish();
    });
}
//# sourceMappingURL=live-playback.js.map