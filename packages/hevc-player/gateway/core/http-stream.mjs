import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Pipe a remux to HTTP while releasing its viewer on every exit path. */
export async function pipeRemuxResponse(stream, response, { headers = {}, explain = (text) => text } = {}) {
  const reader = stream.getReader();
  const abort = new AbortController();
  const cancel = () => reader.cancel().catch(() => undefined);
  const onClose = () => {
    abort.abort();
    void cancel();
  };
  response.once('close', onClose);
  response.once('error', onClose);
  if (response.destroyed) onClose();
  // A blocked socket can stop the generator before its next read. Observe errors
  // independently so queue eviction also closes that viewer's HTTP connection.
  void reader.closed.catch((error) => {
    if (response.headersSent && !response.destroyed) response.destroy(error);
  });

  try {
    // Wait for media before committing a 200 so startup failures remain actionable.
    const first = await reader.read();
    if (abort.signal.aborted) return;
    if (first.done || !first.value?.byteLength) {
      throw new Error('Stream produced no video. Is the RTSP/HLS URL reachable from this streaming server?');
    }
    response.writeHead(200, {
      ...headers,
      'Content-Type': 'video/mp2t',
      'X-Accel-Buffering': 'no',
    });
    const chunks = async function* () {
      yield first.value;
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    };
    // pipeline handles a disconnect/error during backpressure as well as drain.
    await pipeline(Readable.from(chunks()), response, { signal: abort.signal });
  } catch (error) {
    if (response.destroyed || abort.signal.aborted) return;
    if (!response.headersSent) {
      response.writeHead(502, headers);
      response.end(explain(error instanceof Error ? error.message : 'Stream unavailable'));
    } else {
      response.destroy();
    }
  } finally {
    response.removeListener('close', onClose);
    response.removeListener('error', onClose);
    await cancel();
    reader.releaseLock();
  }
}
