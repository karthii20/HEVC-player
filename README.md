# hevc-player

Play **H.264 and H.265 / HEVC with synchronized AAC audio**. Software WebAssembly decode is the default, so playback does not depend on GPU HEVC. Optional `auto` mode tries the browser decoder first. Audio is enabled when present; playback starts muted.

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
# creates hevc-player-0.4.0.tgz
```

Copy `hevc-player-0.4.0.tgz` to the other device, then:

```bash
npm install ./hevc-player-0.4.0.tgz
npx hevc-player-copy-assets public
```

### Option B — npm registry (when you publish)

```bash
npm publish --access public   # from packages/hevc-player after login
# elsewhere:
npm install hevc-player
npx hevc-player-copy-assets public
```

### Option C — git / path (monorepo or private git)

```bash
npm install github:YOUR_ORG/hevc-studio#path:packages/hevc-player
# or locally:
npm install /absolute/path/to/hevc-studio/packages/hevc-player
npx hevc-player-copy-assets public
```

`hevc-player-copy-assets` writes:

- `public/vendor/avplayer.js` (+ worker chunks)
- `public/wasm/h264-simd.wasm`
- `public/wasm/hevc-simd.wasm`
- `public/wasm/aac-simd.wasm`
- `public/wasm/resample-simd.wasm`
- `public/wasm/stretchpitch-simd.wasm`

After upgrading to 0.4.0, rerun `hevc-player-copy-assets` and restart the gateway.

Recommended headers (SharedArrayBuffer workers):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Usage (vanilla) — live RTSP via the bundled gateway

```bash
# Terminal A — requires FFmpeg on PATH
npx hevc-player gateway --port 3002

# Terminal B — your app (after copy-assets)
```

```ts
import {
  createStreamPlayer,
  preloadHevcPlayer,
  createRemuxSession,
} from "hevc-player";

await preloadHevcPlayer();

// Ask the gateway to remux any supported source URL into MPEG-TS.
const streamUrl = await createRemuxSession("rtsp://127.0.0.1:8554/camera1", {
  gatewayUrl: "http://127.0.0.1:3002",
});

const player = await createStreamPlayer(document.getElementById("stage"), {
  url: streamUrl,
  live: true,
  mode: "software", // or "auto"
  audio: true,       // default: decode audio when present
  muted: true,       // default: safe startup for autoplay and camera grids
});

player.stats(); // { fps, width, height, … }
await player.destroy();
```

MediaMTX / OvenMediaEngine viewer pages also work — paste them and the gateway derives the read URL.

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
import { HevcPlayerView } from "hevc-player/react";

export function Preview({ url }: { url: string }) {
  return <HevcPlayerView url={url} live mode="software" audio muted style={{ width: "100%", height: 360 }} />;
}
```

The React wrapper accepts `audio`, `muted`, `volume` and `onReady(player)`.
Changing `muted` or `volume` does not recreate the player. Use `onReady` to keep
the handle in a ref and call `setMuted(false)` directly from your sound button.

In Next.js, copy assets in a setup script and allow the package if needed:

```js
// next.config.mjs
export default { transpilePackages: ["hevc-player"] };
```

## Included components

| Included | Not included |
|---|---|
| Browser H.264 + H.265 + AAC WASM player | FFmpeg executable (install separately on the gateway host) |
| Asset copy CLI (`hevc-player-copy-assets`) | Camera credentials |
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
keyframe. Applications should obtain a fresh session and reconnect after failures;
the gateway does not automatically restart sources, and tickets expire after
60 seconds for new requests. Direct RTSP/HLS registration skips probing; ambiguous
player-page URLs can open temporary FFmpeg probes per registration. Sharing and
tickets are local to a gateway process, so keep registration and playback on the
same instance when deploying multiple replicas.

```bash
npm install hevc-player
npx hevc-player-copy-assets public
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
