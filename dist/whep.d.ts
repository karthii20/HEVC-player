import type { HevcPlayer } from "./types.js";
type IceServer = RTCIceServer;
type CreateWhepPlayerOptions = {
    /** MediaMTX viewer URL or explicit .../whep endpoint. */
    url: string;
    onPlaying?: () => void;
    onError?: () => void;
    onEnded?: () => void;
};
/**
 * Play a MediaMTX WHEP (WebRTC) stream into a container.
 * Many MediaMTX HTTPS links are WebRTC reader pages, not HLS — FFmpeg remux cannot open them.
 */
export declare function createWhepPlayer(container: HTMLDivElement, options: CreateWhepPlayerOptions): Promise<HevcPlayer>;
/** Parse MediaMTX WHEP Link ice-server headers into RTCIceServer objects. */
export declare function parseLinkIceServers(linkHeader: string): IceServer[];
/** Turn MediaMTX WHEP HTTP errors into actionable messages. */
export declare function formatWhepFailure(status: number, detail: string): string;
export {};
//# sourceMappingURL=whep.d.ts.map