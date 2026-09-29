import { toWhepUrl } from "./classify-url.js";
/**
 * Play a MediaMTX WHEP (WebRTC) stream into a container.
 * Many MediaMTX HTTPS links are WebRTC reader pages, not HLS — FFmpeg remux cannot open them.
 */
export async function createWhepPlayer(container, options) {
    if (!container)
        throw new Error("createWhepPlayer needs a DOM container.");
    if (!options?.url)
        throw new Error("createWhepPlayer needs a stream URL.");
    if (typeof RTCPeerConnection === "undefined") {
        throw new Error("This browser does not support WebRTC, which MediaMTX WHEP requires.");
    }
    const whepUrl = toWhepUrl(options.url);
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.controls = false;
    video.setAttribute("playsinline", "true");
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    video.style.background = "#070b0e";
    container.replaceChildren(video);
    const iceServers = await fetchIceServers(whepUrl);
    const pc = new RTCPeerConnection({ iceServers });
    let resourceUrl = null;
    let closed = false;
    let frameTicks = 0;
    const fail = (message) => {
        options.onError?.();
        throw new Error(message);
    };
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (event) => {
        if (closed)
            return;
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        void video.play().catch(() => { });
        options.onPlaying?.();
    };
    pc.onconnectionstatechange = () => {
        if (closed)
            return;
        if (pc.connectionState === "failed")
            options.onError?.();
        if (pc.connectionState === "closed" || pc.connectionState === "disconnected") {
            options.onEnded?.();
        }
    };
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        const response = await fetch(whepUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/sdp",
            },
            body: pc.localDescription?.sdp || offer.sdp,
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            fail(formatWhepFailure(response.status, detail));
        }
        const answer = await response.text();
        const location = response.headers.get("Location") || response.headers.get("location");
        if (location) {
            resourceUrl = new URL(location, whepUrl).toString();
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
    }
    catch (error) {
        await cleanup();
        if (error instanceof Error)
            throw error;
        throw new Error("Unable to start MediaMTX WebRTC playback.");
    }
    async function cleanup() {
        if (closed)
            return;
        closed = true;
        if (resourceUrl) {
            await fetch(resourceUrl, { method: "DELETE" }).catch(() => { });
        }
        try {
            pc.close();
        }
        catch { }
        video.srcObject = null;
        video.remove();
    }
    // Count displayed frames when the browser supports it (stats panel).
    let stopTicker;
    if (typeof video.requestVideoFrameCallback === "function") {
        let handle = 0;
        const tick = () => {
            frameTicks += 1;
            handle = video.requestVideoFrameCallback(tick);
        };
        handle = video.requestVideoFrameCallback(tick);
        stopTicker = () => video.cancelVideoFrameCallback(handle);
    }
    const player = {
        isMuted: () => video.muted,
        getVolume: () => video.volume,
        setVolume: (volume) => {
            if (!Number.isFinite(volume) || volume < 0 || volume > 1)
                throw new RangeError("Volume must be between 0 and 1.");
            video.volume = volume;
        },
        setMuted: async (muted) => {
            video.muted = muted;
            if (!muted) {
                try {
                    await video.play();
                }
                catch (error) {
                    video.muted = true;
                    throw error;
                }
            }
        },
        destroy: async () => {
            stopTicker?.();
            await cleanup();
        },
        on: (_event, _callback) => {
            // Events are wired through create options for this lightweight player.
        },
        stats: () => ({
            fps: 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            dropped: 0,
            frames: frameTicks,
            bitrate: 0,
        }),
    };
    return player;
}
async function fetchIceServers(whepUrl) {
    const servers = [{ urls: "stun:stun.l.google.com:19302" }];
    try {
        const response = await fetch(whepUrl, { method: "OPTIONS" });
        const link = response.headers.get("Link") || response.headers.get("link");
        if (link)
            servers.push(...parseLinkIceServers(link));
    }
    catch {
        // STUN fallback is enough on many networks.
    }
    return servers;
}
/** Parse MediaMTX WHEP Link ice-server headers into RTCIceServer objects. */
export function parseLinkIceServers(linkHeader) {
    const servers = [];
    for (const part of linkHeader.split(/,(?=\s*<)/)) {
        const urlMatch = part.match(/<([^>]+)>/);
        if (!urlMatch)
            continue;
        if (!/rel="?ice-server"?/i.test(part))
            continue;
        const urls = urlMatch[1];
        const username = part.match(/username="([^"]*)"/i)?.[1];
        const credential = part.match(/credential="([^"]*)"/i)?.[1];
        const entry = { urls };
        if (username)
            entry.username = username;
        if (credential)
            entry.credential = credential;
        servers.push(entry);
    }
    return servers;
}
function waitForIceGathering(pc, timeoutMs = 2500) {
    if (pc.iceGatheringState === "complete")
        return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            pc.removeEventListener("icegatheringstatechange", onChange);
            resolve();
        };
        const onChange = () => {
            if (pc.iceGatheringState === "complete")
                done();
        };
        pc.addEventListener("icegatheringstatechange", onChange);
        setTimeout(done, timeoutMs);
    });
}
/** Turn MediaMTX WHEP HTTP errors into actionable messages. */
export function formatWhepFailure(status, detail) {
    const text = (detail || "").trim();
    const lower = text.toLowerCase();
    if (/codecs? not supported/i.test(lower)) {
        return ("WebRTC rejected this stream: codecs not supported by the browser. " +
            "The publisher is likely H.265/HEVC, and stock WebRTC cannot decode that here. " +
            "Use a reachable RTSP URL so HEVC Studio can remux into WASM " +
            "(example that works: rtsp://127.0.0.1:8554/camera1). " +
            "On cloud MediaMTX, open TCP 8554 to this machine, or publish H.264 for WebRTC.");
    }
    return (`MediaMTX WHEP connect failed (${status}). ` +
        `This HTTPS path is WebRTC signaling, not a remuxable media file. ${text.slice(0, 160)}`.trim());
}
//# sourceMappingURL=whep.js.map