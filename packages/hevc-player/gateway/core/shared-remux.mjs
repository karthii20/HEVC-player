import { createMpegTsRemux } from './remux.mjs';
import { StreamConfigurationError, redactStreamDiagnostics } from './stream-source.mjs';

/**
 * One FFmpeg remux per source/input configuration, fan-out to many HTTP viewers.
 *
 * Camera/MediaMTX → 1× FFmpeg (-c:v copy) → N browser connections.
 * Without this, each viewer spawned its own FFmpeg and re-read RTSP.
 */
export function createSharedRemuxHub({
  idleStopMs = 15_000,
  maxSources = 64,
  /** Recent MPEG-TS kept so late joiners get PAT/PMT sooner. */
  bootstrapBytes = 512 * 1024,
  /** Disconnect a lagging viewer instead of buffering indefinitely or stalling all viewers. */
  maxViewerQueueBytes = 1024 * 1024,
  /** Stop a publisher that never starts or stops producing data (0 disables). */
  sourceTimeoutMs = 30_000,
  logPrefix = '[streaming]',
  /**
   * Injectable for tests. Must return a ReadableStream with optional `.diagnostics()`.
   */
  openRemux = (options) => createMpegTsRemux(options),
} = {}) {
  if (!Number.isSafeInteger(maxViewerQueueBytes) || maxViewerQueueBytes <= 0) {
    throw new RangeError('maxViewerQueueBytes must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(bootstrapBytes) || bootstrapBytes < 0) {
    throw new RangeError('bootstrapBytes must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(sourceTimeoutMs) || sourceTimeoutMs < 0) {
    throw new RangeError('sourceTimeoutMs must be a non-negative safe integer.');
  }
  const bootstrapLimit = Math.min(bootstrapBytes, maxViewerQueueBytes);
  /** @type {Map<string, object>} */
  const sources = new Map();

  function sourceKey(sourceUrl, inputArgs) {
    // The same URL with different transport/options is a different publisher.
    return JSON.stringify([sourceUrl, inputArgs]);
  }

  /**
   * Subscribe a viewer to the shared remux for this source.
   * Returns a ReadableStream of MPEG-TS bytes (same shape as createMpegTsRemux).
   */
  function subscribe({ inputArgs, sourceUrl = null, signal, onViewerChange }) {
    if (signal?.aborted) {
      return new ReadableStream({ start(controller) { controller.close(); } });
    }
    const key = sourceKey(sourceUrl, inputArgs);
    let entry = sources.get(key);

    if (!entry) {
      if (sources.size >= maxSources) {
        throw new StreamConfigurationError(
          `Too many unique remux sources (max ${maxSources}). Stop unused cameras or raise STREAM_MAX_SOURCES.`,
          429,
        );
      }
      entry = startSource(key, inputArgs, sourceUrl);
      sources.set(key, entry);
    }

    return attachViewer(entry, { signal, onViewerChange });
  }

  function startSource(key, inputArgs, sourceUrl) {
    const viewers = new Set();
    const bootstrap = [];
    let bootstrapSize = 0;
    let stopTimer = null;
    let closed = false;
    let publisherError = null;

    // The hub owns no-viewer shutdown; the publisher still needs a data watchdog
    // so a dead camera cannot occupy a source slot indefinitely.
    const upstream = openRemux({
      inputArgs,
      sourceUrl,
      idleMs: sourceTimeoutMs,
      logPrefix,
      onConnectionChange: () => {},
    });

    const reader = upstream.getReader();

    const entry = {
      key,
      sourceUrl,
      viewers,
      bootstrap,
      get viewerCount() {
        return viewers.size;
      },
      diagnostics: () => upstream.diagnostics?.() || '',
      publisherError: () => publisherError,
      clearStopTimer() {
        clearTimeout(stopTimer);
        stopTimer = null;
      },
      removeViewer(viewer) {
        if (!viewers.has(viewer)) return;
        viewers.delete(viewer);
        if (!closed && viewers.size === 0) scheduleStop();
      },
    };

    function scheduleStop() {
      // Live bytes keep arriving after the last viewer leaves. They must not extend
      // the idle grace period or FFmpeg will never stop for an active camera.
      if (closed || stopTimer !== null) return;
      stopTimer = setTimeout(() => {
        if (viewers.size === 0) tearDown(undefined);
      }, idleStopMs);
      stopTimer.unref?.();
    }

    function pushBootstrap(chunk) {
      if (bootstrapLimit === 0) return;
      if (chunk.byteLength >= bootstrapLimit) {
        bootstrap.length = 0;
        // Copy the tail: a subarray would retain the entire oversized backing buffer.
        bootstrap.push(new Uint8Array(chunk.subarray(chunk.byteLength - bootstrapLimit)));
        bootstrapSize = bootstrapLimit;
        return;
      }
      bootstrap.push(chunk);
      bootstrapSize += chunk.byteLength;
      while (bootstrapSize > bootstrapLimit) {
        const excess = bootstrapSize - bootstrapLimit;
        if (bootstrap[0].byteLength <= excess) {
          bootstrapSize -= bootstrap.shift().byteLength;
        } else {
          bootstrap[0] = new Uint8Array(bootstrap[0].subarray(excess));
          bootstrapSize -= excess;
        }
      }
    }

    function broadcast(chunk) {
      pushBootstrap(chunk);
      for (const viewer of [...viewers]) {
        try {
          viewer.enqueue(chunk);
        } catch (error) {
          viewer.error(error);
        }
      }
      if (viewers.size === 0) scheduleStop();
    }

    function tearDown(error) {
      if (closed) return;
      closed = true;
      clearTimeout(stopTimer);
      publisherError = error || null;
      // Remove the entry before notifying viewers, so reconnects cannot attach to it.
      if (sources.get(key) === entry) sources.delete(key);
      for (const viewer of [...viewers]) {
        try {
          if (error) viewer.error(error);
          else viewer.close();
        } catch {
          /* already closed */
        }
      }
      viewers.clear();
      bootstrap.length = 0;
      bootstrapSize = 0;
      void reader.cancel().catch(() => undefined);
    }

    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) broadcast(value);
        }
        tearDown(undefined);
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error('Shared remux upstream failed.');
        console.error(logPrefix, 'shared remux ended', redactStreamDiagnostics(err.message, sourceUrl));
        tearDown(err);
      }
    })();

    return entry;
  }

  function attachViewer(entry, { signal, onViewerChange }) {
    entry.clearStopTimer();

    let streamController;
    let detached = false;

    const viewer = {
      enqueue(chunk) {
        if (chunk.byteLength > streamController.desiredSize) {
          throw new Error('Stream viewer is too slow; reconnect to resume live playback.');
        }
        streamController.enqueue(chunk);
      },
      close() {
        detach();
        try {
          streamController.close();
        } catch {
          /* ignore */
        }
      },
      error(err) {
        detach();
        try {
          streamController.error(err);
        } catch {
          /* ignore */
        }
      },
    };

    const detach = () => {
      if (detached) return;
      detached = true;
      entry.removeViewer(viewer);
      onViewerChange?.(-1);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      viewer.close();
    };

    const stream = new ReadableStream(
      {
        start(controller) {
          streamController = controller;
          for (const chunk of entry.bootstrap) {
            controller.enqueue(chunk);
          }
          entry.viewers.add(viewer);
          onViewerChange?.(1);

          const existing = entry.publisherError?.();
          if (existing) {
            queueMicrotask(() => viewer.error(existing));
          }
        },
        cancel() {
          detach();
        },
      },
      {
        highWaterMark: maxViewerQueueBytes,
        size: (chunk) => chunk.byteLength,
      },
    );

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    stream.diagnostics = () => entry.diagnostics();
    return stream;
  }

  return {
    subscribe,
    stats() {
      let viewers = 0;
      const sourceList = [];
      for (const entry of sources.values()) {
        viewers += entry.viewerCount;
        sourceList.push({
          key: entry.sourceUrl ? redactStreamDiagnostics(entry.sourceUrl, entry.sourceUrl) : '[local input]',
          viewers: entry.viewerCount,
        });
      }
      return { sources: sources.size, viewers, sourceList };
    },
    _size: () => sources.size,
  };
}
