# FFmpeg-free go2rtc trial

This optional experiment replaces the per-viewer Node/FFmpeg remux path with:

`RTSP camera → go2rtc shared source → HTTP MPEG-TS → hevc-player`

The page also offers native browser video/audio using HTTP fragmented MP4.

go2rtc reads the compressed RTSP media itself. A named direct RTSP source is
shared by its consumers, and video is repackaged rather than re-encoded.
The Docker image includes FFmpeg, but this configuration does not invoke it.
Do not add `ffmpeg:` or `exec:` sources for this experiment.

This is a trial configuration, not a 400-camera capacity claim. It leaves the
existing application and its gateway unchanged.

## VMS workload: 16–20 cameras per grid

The target deployment has 400 configured cameras, with only 16–20 visible in one
operator's grid. Switching grids must release the previous grid's subscriptions
and decoder resources. Size live viewing by simultaneous operators and their
visible streams, rather than assuming every configured camera is being viewed.

For each grid switch, cancel pending starts and reconnect timers, destroy the
old players, and then start the new grid. Ignore stale completion callbacks from
the old grid. The current package can destroy established players, but does not
expose cancellation of a pending `createStreamPlayer()` call; this still needs
to be addressed before promising an exact 20-stream cap during rapid switches.

Share each named camera stream across viewers. Releasing one viewer must not
stop a source still needed by another viewer, a recorder, or an analytics
consumer. Recording or explicitly preloaded streams may remain connected even
when absent from the visible grid.

Use the camera's substream for grid tiles and test automatic/native decoding
before using software HEVC for all 20 tiles. Gateway process savings do not
remove the browser's decoding work. Enable sound for the selected camera when
the chosen playback path supports its audio codec.

## Run from this repository

From the repository root, with Node dependencies installed:

```sh
npm run build:player
node examples/go2rtc/prepare.mjs
cp -n examples/go2rtc/go2rtc.yaml.example examples/go2rtc/go2rtc.yaml
```

Edit `examples/go2rtc/go2rtc.yaml` and replace the sample RTSP URL with a camera
reachable from Docker. Keep credentials in that ignored file. Then run:

```sh
docker compose -f examples/go2rtc/compose.yaml up -d
```

Open <http://127.0.0.1:1984/>. The example serves its player assets and stream from
the same origin. The preparation script stages the package's ESM distribution,
including its embedded player and codec payload. Start with `camera1` and one
viewer, then compare four viewers of that same source. The service uses a separate Compose project and
binds only to loopback; the existing application does not need to be stopped.
go2rtc's static server does not supply the cross-origin isolation headers used
by the VMS. WASM worker support/performance can differ; match those headers
through your VMS proxy before comparing client performance.

The local page is limited to four simultaneous viewers because long-lived
HTTP/1.1 streams consume the browser's small per-origin connection pool. Use an
HTTP/2 reverse proxy for larger single-browser grids; extra tabs in the same
browser do not solve that limit. Test many operators on independent clients.
Stop releases established players; if a package load stalls, reload the page to
cancel it immediately (the current player creation API has no AbortSignal).

Stop the trial with:

```sh
docker compose -f examples/go2rtc/compose.yaml down
```

## Audio and latency

- **Browser video + audio:** uses a native `<video controls>` element. It can
  play compatible video with AAC audio directly. Unmute the desired tile with
  its controls. Native H.265 decoding depends on the browser, OS and hardware.
- **HEVC package:** uses `createStreamPlayer` directly with `ext: 'ts'` and
  either automatic or software decoding. This trial explicitly uses `audio: false`.
  Package 0.4.0 adds synchronized AAC playback and mute/volume controls. To extend
  this trial, supply AAC in the source and enable audio with a user-gesture sound
  control; other camera audio formats still require conversion.
- **G.711 or Opus cameras:** the default HTTP MP4 path is not the audio path to
  assume. Use a compatible WebRTC path or configure the camera to provide AAC;
  otherwise codec conversion is a separate requirement. This example disables
  the WebRTC listener and does not configure conversion.
- **Latency:** go2rtc documents startup delay for progressive HTTP MP4. This
  experiment is not a claim that MP4 will match WebRTC latency. Measure both
  startup and steady-state latency. Native Safari MP4 requests are redirected
  by go2rtc to HLS. The package's TS path avoids that MP4 redirect.

## Integrate with the npm player

Once the source works, the essential integration in a bundled browser app is:

```js
import { createStreamPlayer } from 'hevc-player';

const player = await createStreamPlayer(container, {
  // Proxy this read endpoint through the VMS's authenticated origin in production.
  url: '/camera-media/api/stream.ts?src=camera1',
  live: true,
  ext: 'ts',
  mode: 'auto',
  audio: false,
});

// On tile removal:
await player.destroy();
```

With package 0.5.0, the ordinary import loads the embedded player, worker chunks
and WASM modules from your application's JavaScript. No asset-copy step or
separate CDN/codec download is required. For custom static asset hosting and CSP
requirements, see [the player README](../../packages/hevc-player/README.md).
Do not pass this URL to `createRemuxSession`: that would start FFmpeg again.
The existing Studio paste UI also routes media URLs through remux, so use this
trial page or direct player API until a direct-play UI option is added.
Do not expose go2rtc's management API to VMS viewers; map authorized camera IDs
to configured stream names in your application and expose only playback routes.

## What to measure

Compare the same camera, bitrate, resolution, viewer count and decoding mode:

1. With multiple viewers of `camera1`, inspect the local `/api/streams` response
   and confirm one camera producer is shared by multiple consumers. The response
   may contain camera URLs; do not publish it or print it in shared logs.
2. Use `docker compose -f examples/go2rtc/compose.yaml stats --no-stream` for CPU,
   memory and network traffic, and `docker compose -f examples/go2rtc/compose.yaml
   top` to confirm no FFmpeg child process is running.
3. Measure startup delay, end-to-end latency, dropped frames and client CPU.
4. Disconnect/reconnect viewers and a camera, then check that connections and
   memory return to a stable level.
5. Through an HTTP/2 proxy, test 16 and 20 distinct named cameras per grid, then
   repeatedly switch between groups drawn from the 400-camera inventory. Confirm
   the previous grid's consumers and decoder workers are released, including
   when switching during startup or camera failures.
6. Repeat with the expected number of simultaneous operators, including users
   viewing the same cameras and different cameras. Track peak connections during
   switching as well as steady-state CPU, memory and bandwidth.

Sharing reduces repeated source reads and process overhead. Each viewer still
requires outgoing network traffic and browser decoding. A single viewer of each
of 400 different cameras still needs 400 upstream sources, but that is not this
VMS's single-operator grid workload. Multiple operators or continuous recording
can still make all 400 sources active on the server.

## Upstream references

- [go2rtc v1.9.14](https://github.com/AlexxIT/go2rtc/releases/tag/v1.9.14)
- [Pinned native MPEG-TS handler](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/mpegts/mpegts.go)
- [Pinned H.264/H.265/AAC TS consumer](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/pkg/mpegts/consumer.go)
- [MP4 endpoints and supported codecs](https://github.com/AlexxIT/go2rtc/blob/master/internal/mp4/README.md)
- [Pinned MP4 handler](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/mp4/mp4.go)
- [HTTP API and static serving](https://github.com/AlexxIT/go2rtc/blob/master/internal/api/README.md)
- [Browser HTTP/1.x connection limits](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Connection_management_in_HTTP_1.x#domain_sharding)
