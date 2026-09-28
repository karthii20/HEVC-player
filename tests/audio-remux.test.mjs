import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSharedRemuxHub, createMpegTsRemux } from 'stream-core';

const exec = promisify(execFile);
test('shared remux carries AAC audio and unchanged video; audio-less sources still work', { timeout: 30000 }, async (t) => {
  try { await exec('ffmpeg', ['-version']); await exec('ffprobe', ['-version']); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Requires FFmpeg and ffprobe'); return; } throw error; }
  const dir = await mkdtemp(path.join(tmpdir(), 'hevc-audio-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'camera.mkv');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000', '-t', '1', '-c:v', 'libx264', '-threads', '1',
    '-preset', 'ultrafast', '-g', '10', '-c:a', 'pcm_mulaw', input]);
  const silent = path.join(dir, 'silent.mkv');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:v', '-c', 'copy', silent]);
  const hevc = path.join(dir, 'hevc-opus.mkv');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-c:v', 'libx265', '-threads', '1',
    '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-c:a', 'libopus', '-ar', '48000', hevc]);
  const aac = path.join(dir, 'aac.mkv');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', aac]);

  for (const [name, file, hasAudio, videoCodec] of [
    ['g711', input, true, 'h264'], ['opus', hevc, true, 'hevc'], ['aac', aac, true, 'h264'], ['silent', silent, false, 'h264'],
  ]) {
    let opens = 0;
    const hub = createSharedRemuxHub({ openRemux: (options) => { opens += 1; return createMpegTsRemux(options); } });
    const source = { inputArgs: ['-i', file] };
    const streams = [hub.subscribe(source), hub.subscribe(source)];
    const outputs = await Promise.all(streams.map(async (stream) => {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    }));
    assert.equal(opens, 1);
    assert.deepEqual(outputs[0], outputs[1]);
    assert.equal(hub.stats().viewers, 0);
    const output = path.join(dir, `${name}.ts`);
    await writeFile(output, outputs[0]);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]);
    const tracks = JSON.parse(stdout).streams;
    assert.equal(tracks.find(track => track.codec_type === 'video').codec_name, videoCodec);
    const audio = tracks.find(track => track.codec_type === 'audio');
    if (hasAudio) {
      assert.equal(audio.codec_name, 'aac');
      assert.equal(audio.sample_rate, '48000');
      assert.equal(audio.channels, 2);
      const video = tracks.find(track => track.codec_type === 'video');
      assert(Math.abs(Number(audio.start_time) - Number(video.start_time)) < 0.1, 'audio/video timestamps remain aligned');
      const { stdout: pcm } = await exec('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer' });
      let energy = 0;
      for (let offset = 0; offset + 4 <= pcm.length; offset += 4) energy += pcm.readFloatLE(offset) ** 2;
      assert(Math.sqrt(energy / (pcm.length / 4)) > 0.01, 'decoded audio contains the generated tone');
    } else assert.equal(audio, undefined);
    const hashes = await Promise.all([file, output].map(async (media) => {
      const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', media, '-map', '0:v', '-f', 'framemd5', 'pipe:1']);
      return stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    }));
    assert.deepEqual(hashes[0], hashes[1], 'decoded video frames are unchanged');
  }
});
