# hevc-player

Play **H.264 and H.265 / HEVC with synchronized AAC audio**. Software WebAssembly decode is the default, so playback does not depend on GPU HEVC. Optional `auto` mode tries the browser decoder first. Audio is enabled when present; playback starts muted.

Version **0.5.1** adds automatic live-session recovery, a 0.5–2 second live jitter
buffer, and a renderer that follows container resizing. Video is still copied at
its original resolution and bitrate. These buffer bounds trade some latency for
smoother delivery; total delay also depends on the camera and network.

The package includes the player, worker chunks and all five WebAssembly
modules in a lazily imported JavaScript payload. An ordinary package import works
with a bundler; the built distribution also supports native browser ESM. No
per-application codec asset copy, runtime CDN, or separate codec download is
required. The browser loads the payload from your
application as JavaScript and uses Blob URLs for the player, workers and WASM.
Your application and stream still need to be served normally; this does not make
the whole application available offline automatically.

Browsers cannot open RTSP. This package ships both:

1. The **browser player** (WASM)
2. A **Node.js remux gateway** (`npx hevc-player gateway`) that turns RTSP / HLS / LLHLS / SRT / RTMP into HTTP MPEG-TS

WebRTC / WHEP is optional and uses native codecs only — H.265 over WebRTC is **not** guaranteed. When the browser lacks HEVC WebRTC, use the remux path.

## Install on another device / project

### Option A — tarball (no npm publish)

On the machine that has this repo:

```bash
cd packages/hevc-player
npm install
npm run build
npm pack
# creates hevc-player-0.5.1.tgz
```

Copy `hevc-player-0.5.1.tgz` to the other device, then:

```bash
npm install ./hevc-player-0.5.1.tgz
```

### Option B — npm registry (when you publish)

```bash
npm publish --access public   # from packages/hevc-player after login
# elsewhere:
npm install hevc-player
```

### Option C — git / path (monorepo or private git)

```bash
npm install github:YOUR_ORG/hevc-studio#path:packages/hevc-player
# or locally:
npm install /absolute/path/to/hevc-studio/packages/hevc-player
```

After upgrading, rebuild and redeploy your application to include the new bundled
assets. Restart the gateway if you also upgraded its package.

Recommended headers (SharedArrayBuffer workers):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If your application sets a Content Security Policy, allow Blob URLs for scripts,
workers and WASM fetches (`script-src`, `worker-src` and `connect-src`), and allow
WebAssembly compilation with `'wasm-unsafe-eval'` in `script-src`. Keep your
existing application and stream origins allowed as well.

## Usage (vanilla) — live RTSP via the bundled gateway

```bash
# Terminal A — requires FFmpeg on PATH
npx hevc-player gateway --port 3002

# Terminal B — your app
```

```ts
import {
  startLiveStreamPlayer,
  preloadHevcPlayer,
  createRemuxSession,
} from "hevc-player";

await preloadHevcPlayer(); // optional: warm up the bundled player before use

const player = startLiveStreamPlayer(document.getElementById("stage"), {
  // Called again after disconnects: never reuse an expired stream ticket.
  resolveUrl: (signal) => createRemuxSession("rtsp://127.0.0.1:8554/camera1", {
    gatewayUrl: "http://127.0.0.1:3002",
    signal,
  }),
  mode: "software", // or "auto"
  audio: true,       // default: decode audio when present
  muted: true,       // default: safe startup for autoplay and camera grids
  onStatus: (status) => console.log(status), // Connecting / Playing / Reconnecting
  onError: (message) => console.log(message), // empty after successful recovery
});

player.stats(); // { fps, width, height, … }
await player.destroy();
```

MediaMTX / OvenMediaEngine viewer pages also work — paste them and the gateway derives the read URL.

**Upgrading an existing live integration:** replace the one-time
`createRemuxSession` + `createStreamPlayer` calls with `startLiveStreamPlayer` and
the `resolveUrl` callback above. Updating the package alone does not add ticket
renewal to an existing single-attempt integration. The handle is returned
immediately; `destroy()` cancels pending registration, playback and retries.
Retries back off from 1 to 15 seconds. Playback with no decoded-frame progress
for 30 seconds reconnects too. Invalid registration requests stop with `Error`.
Keep `createStreamPlayer` / `createHevcPlayer` for recorded files or when your
application manages retries itself.

For native browser ESM without a bundler, serve the package's complete `dist/`
directory and import its `index.js` URL in a module script. Keep the adjacent
modules, including the embedded asset payload, alongside it. The go2rtc example
uses this approach.

## Live audio and controls (0.4.0+)

The gateway copies the first video track and converts the first audio track, when
present, to AAC at 48 kHz / stereo / 96 kbps. This supports camera audio such as
G.711 and Opus through FFmpeg without adding browser decoders for every camera
codec. AAC inputs are also re-encoded; video is never re-encoded. Audio processing
runs once in the shared FFmpeg process per source, regardless of viewer count.
Video-only cameras continue to work without a synthetic audio track.

The browser uses libmedia's audio/video timing, AAC decoder, resampler and audio
timing processor. Serve the application over HTTPS or localhost for AudioWorklet
support. Browser autoplay restrictions may suspend audio until a click or tap.
Add a sound button and call the method directly in its click handler:

```ts
// soundButton is your HTML button; player is the handle returned above.
soundButton.onclick = async () => {
  try {
    await player.setMuted(!player.isMuted());
    soundButton.textContent = player.isMuted() ? "Enable sound" : "Mute";
  } catch (error) {
    // Show the error and let the user retry with another click.
    console.error(error);
  }
};
player.setVolume(0.5); // 0–1; changes gain without unmuting or reconnecting
```

`audio: false` explicitly skips audio playback/decoding. Keep `audio: true` and
`muted: true` when you want to enable sound later without restarting the stream.
Muted playback still processes audio for synchronization. For a camera grid,
mute the previously selected tile before unmuting the next one.

Direct file/stream playback supports bundled H.264/H.265 video and AAC audio.
For other audio codecs, use the gateway to normalize audio to AAC or opt out with
`audio: false`. Setting `muted: false` at startup does not bypass browser policy;
`setMuted(false)` from a user gesture resumes suspended audio.

## Usage (React / Next.js)

```tsx
"use client";

import { HevcPlayerView } from "hevc-player/react";
import { createRemuxSession } from "hevc-player";
import { useCallback } from "react";

export function Preview({ rtspUrl }: { rtspUrl: string }) {
  const resolveUrl = useCallback((signal: AbortSignal) => createRemuxSession(rtspUrl, {
    gatewayUrl: "http://127.0.0.1:3002", signal,
  }), [rtspUrl]);
  return <HevcPlayerView resolveUrl={resolveUrl} live mode="software" audio muted style={{ width: "100%", height: 360 }} />;
}
```

The React wrapper accepts `audio`, `muted`, `volume` and `onReady(player)`.
Use `resolveUrl` for live reconnection; a plain `url` keeps single-attempt behavior.
Changing `muted` or `volume` does not recreate the player. Use `onReady` to keep
the handle in a ref and call `setMuted(false)` directly from your sound button.

In Next.js, render the wrapper from a Client Component as above. No asset-copy
setup script is needed. If your project needs package transpilation:

```js
// next.config.mjs
export default { transpilePackages: ["hevc-player"] };
```

## Optional custom asset hosting

The package also retains the raw `vendor/` player files, worker chunks, WASM
modules and third-party license. Use the copy CLI only when you want to host those
files separately instead of using the embedded defaults:

```bash
npx hevc-player-copy-assets public
```

This writes `public/vendor/avplayer.js` with its worker chunks and license, plus
all five modules in `public/wasm/`: `h264-simd.wasm`, `hevc-simd.wasm`,
`aac-simd.wasm`, `resample-simd.wasm` and `stretchpitch-simd.wasm`.
Configure both paths for custom hosting:

```ts
const player = await createStreamPlayer(container, {
  url: streamUrl,
  scriptUrl: "/vendor/avplayer.js",
  wasmBaseUrl: "/wasm/",
});
```

React accepts the same overrides:

```tsx
<HevcPlayerView url={streamUrl} scriptUrl="/vendor/avplayer.js" wasmBaseUrl="/wasm/" />
```

If you use `preloadHevcPlayer` with custom hosting, pass the same script URL:
`await preloadHevcPlayer("/vendor/avplayer.js")`. Rerun the copy CLI when upgrading
a deployment that uses these custom paths. Omit the overrides for the bundled
defaults.

## Included components

| Included | Not included |
|---|---|
| Browser H.264 + H.265 + AAC WASM player | FFmpeg executable (install separately on the gateway host) |
| Optional asset copy CLI (`hevc-player-copy-assets`) | Camera credentials |
| Remux gateway CLI (`hevc-player gateway`) | Guaranteed H.265 over WebRTC |
| Optional MediaMTX WHEP helper | |

No separate HEVC Studio checkout is required — install `hevc-player` and run the gateway from the same package.

| Codec | WASM file | libmedia id |
|---|---|---|
| H.264 | `h264-simd.wasm` | 27 |
| H.265 | `hevc-simd.wasm` | 173 |
| AAC | `aac-simd.wasm` | 86018 |

Audio also uses `resample-simd.wasm` and `stretchpitch-simd.wasm`.
See [audio asset provenance](wasm/SOURCES.md) for upstream revision and checksums.

## License

Wrapper MIT. Bundled `@libmedia/avplayer` is LGPL-3.0-or-later (Gaoxing Zhao). Open-source decoder code is not an HEVC/H.264 patent license.

HEVC SHA-256: `63576fc0752535da9f7f1374e89ab12c22a0cd4425639f0f8162e589af7faf27`  
H.264 SHA-256: `0c7ff22730ef4ee7b4f99e57d60b6b6212eb2a9b75de1e8190b1501d97212295`

## Bundled gateway (0.3.0+)

Install this package in your application and run the gateway on a machine that can
reach your cameras. The browser player does not start a server automatically.
Node.js 20.12+ (22+ recommended) and FFmpeg are required. Source probes also use FFmpeg.

**Shared remux (0.3.2+):** viewers of the same RTSP/HLS URL and input options share
**one** FFmpeg process per gateway instance. Fifty browsers on one camera → one
remux pipe (fan-out over HTTP).
`GET /health` reports `sharedRemux: true`, `sources` (unique FFmpeg), and `connections` (viewers).

Sources stop 15 seconds after the last viewer leaves (`STREAM_SOURCE_IDLE_MS`).
Startup or playback with no output times out after 30 seconds
(`STREAM_SOURCE_TIMEOUT_MS`; 0 disables). Increase that timeout for long camera
keyframe intervals or slow startup. Slow viewers disconnect at a 1 MiB byte queue
limit (`STREAM_VIEWER_QUEUE_BYTES`); healthy viewers keep receiving video.

The recent-byte bootstrap is bounded to 512 KiB and does not guarantee a complete
keyframe. `startLiveStreamPlayer` obtains a fresh session via `resolveUrl` after failures;
single-attempt integrations must handle that themselves. The gateway does not
automatically restart sources, and tickets expire after
60 seconds for new requests. Direct RTSP/HLS registration skips probing; ambiguous
player-page URLs can open temporary FFmpeg probes per registration. Sharing and
tickets are local to a gateway process, so keep registration and playback on the
same instance when deploying multiple replicas.

```bash
npm install hevc-player
npx hevc-player gateway --port 3002
```

No HEVC Studio checkout is needed. The CLI loads `.env` from the current working
directory. Flags override environment configuration.

```bash
npx hevc-player gateway --port 3002 --origins http://localhost:5173
npx hevc-player gateway --help
```

Register a source with the helper (preferred) or raw `fetch`:

```js
import { createStreamPlayer, createRemuxSession } from "hevc-player";

const streamUrl = await createRemuxSession("rtsp://127.0.0.1:8554/camera1", {
  gatewayUrl: "http://127.0.0.1:3002",
});
const player = await createStreamPlayer(container, {
  url: streamUrl,
  live: true,
  mode: "software",
});
```

`GET /health` reports gateway readiness and connection counts. The default bind
address is loopback. For a remote deployment use `--host` and `--public-url`, an
HTTPS reverse proxy, and authentication. The gateway can open user-supplied source
addresses; restrict access and destinations before exposing it publicly.
It copies video without re-encoding and includes optional audio normalized to AAC.
The current gateway does not receive WHEP-only streams.

## Recorded H.265 video

For an HTTP-accessible H.265 MP4, use the browser player directly:

```js
const player = await createStreamPlayer(container, {
  url: "https://your-server.example/recordings/video.mp4",
  live: false,
  ext: "mp4",
  mode: "software",
  audio: false,
});
```

No gateway is required for this MP4 URL. Serve it with appropriate CORS headers
when cross-origin and HTTP byte-range support for efficient random access. File
compatibility and performance depend on the encoding and device. The wrapper
currently exposes start, destroy, events, and statistics; it does not yet expose
pause or seek controls, so it is not a full recorded-video playback UI. The example
opts out of audio; remove `audio: false` to play an AAC track, then unmute from a
user gesture.
