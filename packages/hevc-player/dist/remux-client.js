/**
 * Talk to the remux gateway that ships with this package (`npx hevc-player gateway`).
 * Browsers cannot open RTSP; the gateway turns it into HTTP MPEG-TS for the WASM player.
 */
/**
 * Register a source URL with the gateway and return the MPEG-TS play URL.
 * Accepts RTSP, HLS, LLHLS, SRT, RTMP, and MediaMTX / OvenMediaEngine player pages.
 */
export async function createRemuxSession(sourceUrl, options = {}) {
    if (!sourceUrl?.trim()) {
        throw new Error("createRemuxSession needs a stream URL.");
    }
    const base = (options.gatewayUrl ?? "").replace(/\/$/, "");
    const endpoint = `${base}/v1/sessions`;
    let response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            signal: options.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: sourceUrl.trim(),
                skipProbe: options.skipProbe === true,
            }),
        });
    }
    catch {
        if (options.signal?.aborted)
            throw new DOMException("Playback was cancelled.", "AbortError");
        throw new Error("Cannot reach the hevc-player gateway. Start it with: npx hevc-player gateway");
    }
    const result = (await response.json().catch(() => ({})));
    if (!response.ok || !result.streamUrl) {
        if (!result.error && (response.status === 500 || response.status === 502)) {
            throw new Error("Remux gateway is not reachable (proxy returned " +
                `${response.status}). Start it with: npx hevc-player gateway ` +
                "(or use `pnpm run dev` which starts both).");
        }
        throw Object.assign(new Error(result.error || `Remux failed (${response.status})`), {
            retryable: response.status >= 500 || response.status === 429 || response.status === 408,
        });
    }
    // When using a same-origin proxy, keep only path+query so playback stays same-origin.
    if (!base) {
        const { pathname, search } = new URL(result.streamUrl, "http://127.0.0.1");
        return `${pathname}${search}`;
    }
    return result.streamUrl;
}
//# sourceMappingURL=remux-client.js.map