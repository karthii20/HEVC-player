# hevc-player 0.5.1 — RTSP viewing stability (2026-09-28)

- Browser: generated H.264/H.265 MP4 and MPEG-TS decode with synchronized AAC.
- Browser: resizing the viewer to 640×384 updates the canvas backing resolution.
- Browser: cancelling an HTTP stream stalled during startup releases its request
  and renderer without stale callbacks.
- Browser: 150-second real-time HEVC stream test with a 60-second session ticket.
  A forced disconnect after 70 seconds triggers fresh registration and resumes
  playback. Two registrations, two media connections, one forced disconnect;
  recovered stream renders at 12 FPS with zero dropped frames and no browser errors.
- All 90 unit/regression tests pass: fresh-ticket retries, capped backoff, frozen decoding,
  cancellation, resize, mute/volume restoration, reusable unexpired tickets, and
  output backpressure that must not trip the camera inactivity watchdog.
- Real FFmpeg checks compare decoded frame hashes before/after remux for H.264
  and H.265, and exercise optional G.711/Opus/AAC input audio normalized to AAC.
- Player and root TypeScript checks and `next build --webpack` pass.

The long browser check uses a local fixture server that emulates gateway ticket
expiry and streams real FFmpeg output. It does not establish an RTSP connection
to the user's camera. Actual camera quality and long-duration operation still
need verification in the consuming application.

Reproduce the browser check after building the player:

```bash
LIVE_SOAK_SECONDS=150 LIVE_DISCONNECT_SECONDS=70 node tests/browser-smoke.mjs
```

For automatic renewal, consuming applications must use `startLiveStreamPlayer`
with `resolveUrl`, or the React wrapper's `resolveUrl` prop. See the package README.
Existing `createStreamPlayer` / `createHevcPlayer` calls remain single-attempt APIs.

## Previous v1.3.0 multi-service validation

- Unit tests (7) pass against `stream-core`.
- Frontend production build and typecheck pass.
- Streaming health reports codecs H.264 and H.265.
- Backend `/api/status` reports both codecs and streaming reachability.
- Demo remux produced MPEG-TS bytes over `/v1/stream?source=demo` (copy, no transcode).
- Backend POST `/api/stream` returns an opaque streaming ticket URL.

Run with `npm run dev` (frontend :3000, backend :3001, streaming :3002).
