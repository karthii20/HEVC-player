import { access, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../packages/hevc-player/dist');
try {
  await access(path.join(dist, 'index.js'));
} catch {
  throw new Error('Build the player first: npm run build:player');
}
const dest = path.join(here, 'public');
await mkdir(dest, { recursive: true });
await cp(dist, path.join(dest, 'player'), { recursive: true });
await cp(path.join(here, 'trial.html'), path.join(dest, 'index.html'));
console.log('Trial assets ready. Configure go2rtc.yaml, then start the example Compose service.');
