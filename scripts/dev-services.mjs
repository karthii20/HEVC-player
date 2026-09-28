#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const children = [];
function run(name, args, color) {
  const child = spawn('npm', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: false,
  });
  const tag = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line) console.log(`${color}[${name}]\x1b[0m ${line}`);
    }
  };
  child.stdout.on('data', tag);
  child.stderr.on('data', tag);
  child.on('exit', (code, signal) => {
    console.log(`[dev] ${name} exited`, code ?? signal);
    for (const other of children) {
      if (other !== child) other.kill('SIGTERM');
    }
    process.exit(code ?? 1);
  });
  children.push(child);
}

run('streaming', ['run', 'dev', '-w', '@hevc-studio/streaming'], '\x1b[36m');
run('backend', ['run', 'dev', '-w', '@hevc-studio/backend'], '\x1b[33m');
run('frontend', ['run', 'dev', '-w', '@hevc-studio/frontend'], '\x1b[32m');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}

console.log('[dev] frontend :3000 · backend :3101 · streaming :3002');
