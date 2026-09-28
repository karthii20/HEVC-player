#!/usr/bin/env node
/** @deprecated Use: npm run diagnose -w @hevc-studio/streaming */
import { spawn } from 'node:child_process';
const child = spawn('npm', ['run', 'diagnose', '-w', '@hevc-studio/streaming', '--', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
});
child.on('exit', (code) => process.exit(code ?? 0));
