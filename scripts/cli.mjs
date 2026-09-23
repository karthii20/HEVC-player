#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const help = `Usage: hevc-player gateway [options]

Start the H.264/H.265 RTSP/HLS → HTTP MPEG-TS gateway.
Requires Node.js 20.12+ (22+ recommended) and FFmpeg on PATH (ffprobe for source probing).

  --port <number>       Listening port (default: 3002)
  --host <address>      Bind address (default: 127.0.0.1)
  --public-url <url>    Browser-facing gateway URL
  --origins <list>      Comma-separated allowed browser origins
  --ffmpeg <path>       FFmpeg executable
  --help               Show this help

Environment variables and a .env in the current directory are supported.
CLI flags take precedence. Keep remote deployments behind authentication.
This gateway requires a media source; WHEP-only H.265 is not supported.`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean' }, port: { type: 'string' }, host: { type: 'string' },
      'public-url': { type: 'string' }, origins: { type: 'string' }, ffmpeg: { type: 'string' },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(help);
  } else {
    if (positionals.length !== 1 || positionals[0] !== 'gateway') throw new Error('Expected command: gateway. Use --help.');
    if (typeof process.loadEnvFile !== 'function') throw new Error('The gateway requires Node.js 20.12 or newer (22+ recommended).');
    if (values.port && (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)) throw new Error('--port must be between 1 and 65535.');
    if (values['public-url'] && !['http:', 'https:'].includes(new URL(values['public-url']).protocol)) throw new Error('--public-url must use HTTP or HTTPS.');
    const mapping = { port: 'STREAMING_PORT', host: 'BIND_ADDRESS', 'public-url': 'STREAM_PUBLIC_URL', origins: 'ALLOWED_ORIGINS', ffmpeg: 'FFMPEG_PATH' };
    for (const [flag, env] of Object.entries(mapping)) if (values[flag] !== undefined) process.env[env] = values[flag];
    const { existsSync } = await import('node:fs');
    if (existsSync('.env')) process.loadEnvFile('.env');
    const probe = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.error || probe.status !== 0) throw new Error('FFmpeg could not run. Install FFmpeg or set --ffmpeg /path/to/ffmpeg.');
    await import('../gateway/server.mjs');
  }
} catch (error) {
  console.error(`hevc-player: ${error.message}`);
  process.exitCode = 1;
}
