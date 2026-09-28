"use client";
import { startLiveStreamPlayer, preloadHevcPlayer, type HevcDecodeMode, type HevcPlayer } from "hevc-player";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<HevcPlayer | null>(null);
  const [ready, setReady] = useState(false), [camera, setCamera] = useState(false);
  const [mediaMtx, setMediaMtx] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [source, setSource] = useState("custom"), [mode, setMode] = useState<HevcDecodeMode>("software");
  const [rtspUrl, setRtspUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [status, setStatus] = useState("Ready"), [error, setError] = useState("");
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState({ fps: 0, width: 0, height: 0, dropped: 0, frames: 0, bitrate: 0 });
  const [isolated, setIsolated] = useState(false);
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    setIsolated(crossOriginIsolated);
    preloadHevcPlayer().then(() => setReady(true)).catch((error) => setError(error instanceof Error ? error.message : "Player could not load."));
    fetch("/api/status", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("Configuration unavailable");
      return r.json();
    }).then((d) => {
      setCamera(d.cameraConfigured);
      setMediaMtx(d.mediaMtxConfigured);
      setSourceErrors(d.sourceErrors ?? {});
      setConfigured(true);
    }).catch(() => setError("Server status unavailable."));
    return () => {
      const old = player.current;
      player.current = null;
      void old?.destroy();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!player.current) return;
      setStats(player.current.stats());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  async function stop() {
    setBusy(true);
    const old = player.current;
    player.current = null;
    try { await old?.destroy(); } finally { setActive(false); setBusy(false); setStatus("Stopped"); setError(""); }
  }
  function start() {
    if (!ready || !configured || !container.current || busy || active || player.current) return;
    if (sourceErrors[source]) { setError(sourceErrors[source]); setStatus("Configuration needed"); return; }
    const element = container.current;
    setActive(true); setError(""); setStatus("Connecting"); setMuted(true);
    setStats({ fps: 0, width: 0, height: 0, dropped: 0, frames: 0, bitrate: 0 });
    const current = startLiveStreamPlayer(element, {
      mode,
      async resolveUrl(signal) {
        let streamUrl = "/api/stream?source=" + source;
        if (source === "custom") {
          const response = await fetch("/api/stream", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({url: rtspUrl.trim()}),
            signal,
          });
          const result = await response.json();
          if (!response.ok) {
            throw Object.assign(new Error(result.error || "Unable to connect to this RTSP stream."), {
              retryable: response.status >= 500 || response.status === 429 || response.status === 408,
            });
          }
          streamUrl = result.streamUrl;
        }
        return new URL(streamUrl, location.origin).href;
      },
      onStatus(next, delay) {
        if (player.current !== current) return;
        setStatus(delay ? `${next} in ${delay / 1000}s` : next);
        if (next === "Error") {
          player.current = null;
          setActive(false);
          void current.destroy();
        }
      },
      onPlaying() {
        if (player.current === current) setMuted(current.isMuted());
      },
      onError(message) {
        if (player.current !== current) return;
        setMuted(current.isMuted());
        setError(message);
      },
    });
    player.current = current;
  }
  return <main>
    <header><a className="brand" href="/">▧ <span>HEVC<span className="light"> Studio</span></span></a><span className="badge">MEDIAMTX + WASM · v1.2.0</span></header>
    <section className="intro"><span className="eyebrow">H.265 / NO INSTALLATION</span><h1>Your stream.<br/><span>Now in the browser.</span></h1><p>A dedicated workspace to test live HEVC playback with a software decoder running on your device.</p></section>
    <div className="workspace"><section className="viewer"><div className="viewerbar"><span><i className={status==="Playing"?"dot live":"dot"}/>{source==="demo"?"HEVC test pattern":source==="mediamtx"?"MediaMTX live stream":source==="custom"?"Your RTSP stream":"Camera 01"}</span><span>{status}</span></div>
      <div className="screen"><div className="canvas" ref={container}/>{!active&&!busy&&<div className="empty"><div className="playicon">▷</div><h2>Ready when you are</h2><p>Select a source and start the stream.</p><small>H.265 video + camera audio · Starts muted</small></div>}</div>
      <button type="button" disabled={!active || busy || status !== "Playing"} onClick={() => {
        const current = player.current;
        if (!current) return;
        void current.setMuted(!muted).then(() => {
          if (player.current === current) setMuted(current.isMuted());
        }).catch((error) => {
          if (player.current !== current) return;
          setMuted(current.isMuted());
          setError(error instanceof Error ? error.message : "Unable to enable sound.");
        });
      }}>{muted ? "Enable sound" : "Mute"}</button>
      <div className="metrics">{[["Render FPS",stats.fps||"—"],["Resolution",stats.width?stats.width+" × "+stats.height:"—"],["Decoded frames",stats.frames],["Dropped frames",stats.dropped]].map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    </section><aside><form onSubmit={e=>{e.preventDefault();void start();}}><span className="eyebrow">STREAM CONTROLS</span><h2>Make the connection</h2>
      <label htmlFor="source">Video source</label><select id="source" value={source} disabled={active||busy} onChange={e=>{setSource(e.target.value);setError("");}}><option value="custom">Add RTSP URL</option><option value="mediamtx" disabled={!mediaMtx}>MediaMTX {mediaMtx?"":"· not configured"}</option><option value="camera" disabled={!camera}>Configured RTSP camera {camera?"":"· not configured"}</option><option value="demo">Built-in H.265 demo</option></select>
      {source==="custom"&&<>
        <label htmlFor="rtsp-url">RTSP URL</label>
        <div className="url-input"><input id="rtsp-url" type={showUrl?"text":"password"} value={rtspUrl} onChange={e=>{setRtspUrl(e.target.value);setError("");}} placeholder="rtsp://camera:554/stream" autoComplete="off" spellCheck={false} maxLength={4096} required disabled={active||busy} aria-describedby="rtsp-hint"/><button type="button" className="reveal-url" aria-label={showUrl?"Hide RTSP URL":"Show RTSP URL"} aria-pressed={showUrl} onClick={()=>setShowUrl(!showUrl)}>{showUrl?"Hide":"Show"}</button></div>
        <p id="rtsp-hint" className="hint">Paste your camera or MediaMTX RTSP read URL, including credentials if required. Use the camera's main stream for full resolution. The URL is used for this connection and is not saved.</p>
      </>}
      {source!=="custom"&&<p className="hint">{source==="demo"?"A looping 720p HEVC test stream served from this application.":source==="mediamtx"?"The server reads the MediaMTX stream over RTSP or HLS. HEVC decoding runs on your device.":"Camera credentials stay on the server."}</p>}
      {sourceErrors[source]&&<p role="alert" className="error">{sourceErrors[source]}</p>}
      <label htmlFor="decoder">Decoder preference</label><select id="decoder" value={mode} disabled={active||busy} onChange={e=>setMode(e.target.value as HevcDecodeMode)}><option value="software">Software · WebAssembly</option><option value="auto">Prefer native · WASM fallback</option></select>
      <p className="hint">Software mode works without native HEVC support. Native preference does not guarantee hardware acceleration.</p>
      <button type="submit" className="primary" disabled={!ready||!configured||busy||active||Boolean(sourceErrors[source])||(source==="custom"&&!rtspUrl.trim())}>{busy?"Connecting…":"▶ Start stream"}</button><button type="button" disabled={!active||busy} onClick={stop}>Stop stream</button>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="environment"><span className="dot live"/> {isolated?"Isolated context · workers available":"Single-context fallback"}<br/><span className="transport">MPEG-TS / HTTP · Video copy + AAC audio</span></div>
    </form></aside></div>
    <section className="notes"><div><b>01 / Add your stream</b><p>Paste an RTSP URL and click Start stream. Interrupted streams reconnect automatically until you press Stop stream.</p></div><div><b>02 / Decode in the browser</b><p>Software · WebAssembly plays H.265 without native HEVC support. Use the RTSP read URL for MediaMTX; a /whep URL is not a video source for this player.</p></div><div><b>03 / Picture quality</b><p>Video keeps the camera's original resolution and quality. Use its main stream for more detail. If frames keep dropping, try Prefer native or a lower resolution suited to your device.</p></div></section>
    <footer>HEVC Studio <span>hevc-player package · Browser-only viewing</span></footer>
  </main>;
}
