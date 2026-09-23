"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createHevcPlayer } from "./create-player.js";
import type { HevcDecodeMode, HevcPlayer } from "./types.js";

type HevcPlayerProps = {
  url: string;
  live?: boolean;
  mode?: HevcDecodeMode;
  audio?: boolean;
  muted?: boolean;
  volume?: number;
  /** Access mute/volume controls, e.g. setMuted(false) from a button click. */
  onReady?: (player: HevcPlayer) => void;
  className?: string;
  style?: CSSProperties;
  onPlaying?: () => void;
  onError?: () => void;
  onEnded?: () => void;
  onTimeout?: () => void;
};

/**
 * Drop-in React wrapper around createHevcPlayer.
 * The host page must still serve /vendor and /wasm (see copy-assets).
 */
export function HevcPlayerView({
  url,
  live = true,
  mode = "software",
  audio = true,
  muted = true,
  volume = 1,
  onReady,
  className,
  style,
  onPlaying,
  onError,
  onEnded,
  onTimeout,
}: HevcPlayerProps) {
  const container = useRef<HTMLDivElement>(null);
  const currentPlayer = useRef<HevcPlayer | null>(null);
  const audioSettings = useRef({ muted, volume });
  audioSettings.current = { muted, volume };
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onPlayingRef = useRef(onPlaying);
  const onErrorRef = useRef(onError);
  const onEndedRef = useRef(onEnded);
  const onTimeoutRef = useRef(onTimeout);
  onPlayingRef.current = onPlaying;
  onErrorRef.current = onError;
  onEndedRef.current = onEnded;
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const element = container.current;
    if (!element || !url) return;

    let cancelled = false;
    let instance: HevcPlayer | null = null;

    createHevcPlayer(element, {
      url,
      live,
      mode,
      audio,
      muted: audioSettings.current.muted,
      volume: audioSettings.current.volume,
      onPlaying: () => onPlayingRef.current?.(),
      onError: () => onErrorRef.current?.(),
      onEnded: () => onEndedRef.current?.(),
      onTimeout: () => onTimeoutRef.current?.(),
    })
      .then((player) => {
        if (cancelled) {
          void player.destroy();
          return;
        }
        instance = player;
        currentPlayer.current = player;
        player.setVolume(audioSettings.current.volume);
        void player.setMuted(audioSettings.current.muted).catch(() => onErrorRef.current?.());
        onReadyRef.current?.(player);
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      if (currentPlayer.current === instance) currentPlayer.current = null;
      void instance?.destroy();
    };
  }, [url, live, mode, audio]);

  useEffect(() => {
    const player = currentPlayer.current;
    if (!player) return;
    try {
      player.setVolume(volume);
      void player.setMuted(muted).catch(() => onErrorRef.current?.());
    } catch {
      onErrorRef.current?.();
    }
  }, [muted, volume]);

  return <div ref={container} className={className} style={style} />;
}
