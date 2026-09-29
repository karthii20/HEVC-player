/**
 * Talk to the remux gateway that ships with this package (`npx hevc-player gateway`).
 * Browsers cannot open RTSP; the gateway turns it into HTTP MPEG-TS for the WASM player.
 */
export type CreateRemuxSessionOptions = {
    /** Cancel registration when a viewing session stops or retries. */
    signal?: AbortSignal;
    /**
     * Base URL of the gateway, e.g. `http://127.0.0.1:3002`.
     * Leave empty (default) when a same-origin proxy forwards `/v1` to the gateway.
     */
    gatewayUrl?: string;
    /**
     * Skip the pre-flight FFmpeg probe. Use for multi-camera walls so each camera
     * is not opened twice (probe + stream).
     */
    skipProbe?: boolean;
};
/**
 * Register a source URL with the gateway and return the MPEG-TS play URL.
 * Accepts RTSP, HLS, LLHLS, SRT, RTMP, and MediaMTX / OvenMediaEngine player pages.
 */
export declare function createRemuxSession(sourceUrl: string, options?: CreateRemuxSessionOptions): Promise<string>;
//# sourceMappingURL=remux-client.d.ts.map