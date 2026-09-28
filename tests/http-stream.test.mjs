import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { pipeRemuxResponse } from 'stream-core';

class Response extends Writable {
  headersSent = false;
  chunks = [];

  constructor(write) {
    super({ highWaterMark: 1 });
    this.writeChunk = write;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    if (this.writeChunk) this.writeChunk(chunk, callback);
    else callback();
  }
}

test('HTTP remux forwards first and later chunks, then releases its reader', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  const response = new Response();
  await pipeRemuxResponse(stream, response, { headers: { 'Cache-Control': 'no-store' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'video/mp2t');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual([...Buffer.concat(response.chunks)], [1, 2, 3, 4]);
  assert.equal(stream.locked, false);
});

test('HTTP remux reports startup failure before committing media headers', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('no camera')); } });
  const response = new Response();
  await pipeRemuxResponse(stream, response, { explain: (text) => `Diagnosis: ${text}` });
  assert.equal(response.status, 502);
  assert.equal(Buffer.concat(response.chunks).toString(), 'Diagnosis: no camera');
  assert.equal(stream.locked, false);
});

test('HTTP remux disconnect cancels a source still waiting for its first bytes', { timeout: 2000 }, async () => {
  let cancels = 0;
  const stream = new ReadableStream({ cancel() { cancels += 1; } });
  const response = new Response();
  const pending = pipeRemuxResponse(stream, response);
  response.destroy();
  await pending;
  assert.equal(cancels, 1);
  assert.equal(response.headersSent, false);
  assert.equal(stream.locked, false);
});

test('HTTP remux disconnect while backpressured does not wait forever for drain', { timeout: 2000 }, async () => {
  let cancels = 0;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); },
    cancel() { cancels += 1; },
  });
  let started;
  const writing = new Promise((resolve) => { started = resolve; });
  const response = new Response(() => started());
  const pending = pipeRemuxResponse(stream, response);
  await writing;
  response.destroy();
  await pending;
  assert.equal(cancels, 1);
  assert.equal(stream.locked, false);
});

test('HTTP remux destroys an already-started response on upstream error', { timeout: 2000 }, async () => {
  let controller;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      controller.enqueue(new Uint8Array([1]));
    },
  });
  const response = new Response((chunk, callback) => {
    callback();
    controller.error(new Error('source stopped'));
  });
  await pipeRemuxResponse(stream, response);
  assert.equal(response.status, 200);
  assert.equal(response.destroyed, true);
  assert.equal(stream.locked, false);
});

test('HTTP remux upstream failure also closes a backpressured response', { timeout: 2000 }, async () => {
  let controller;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      for (let i = 0; i < 4; i += 1) value.enqueue(new Uint8Array([i]));
    },
  });
  let started;
  const writing = new Promise((resolve) => { started = resolve; });
  const response = new Response(() => started());
  const pending = pipeRemuxResponse(stream, response);
  await writing;
  // Allow the generator to prefetch until HTTP backpressure stops further reads.
  await new Promise((resolve) => setImmediate(resolve));
  controller.error(new Error('Stream viewer is too slow'));
  await pending;
  assert.equal(response.destroyed, true);
  assert.equal(stream.locked, false);
});
