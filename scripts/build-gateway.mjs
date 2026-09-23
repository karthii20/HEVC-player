import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = new URL('../gateway/', import.meta.url);
const streamCoreSrc = new URL('../../stream-core/src/', import.meta.url);
const streamingServer = new URL('../../../services/streaming/src/server.mjs', import.meta.url);

async function exists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

/**
 * In the hevc-studio monorepo, rebuild gateway/ from stream-core + services/streaming.
 * In the standalone GitHub package, gateway/ is already committed — keep it.
 */
if (!(await exists(streamCoreSrc)) || !(await exists(streamingServer))) {
  if (!(await exists(new URL('server.mjs', target)))) {
    throw new Error(
      'gateway/ is missing and monorepo sources were not found. ' +
        'Clone hevc-studio to rebuild, or restore packages/hevc-player/gateway/.',
    );
  }
  console.log(`Using committed gateway at ${fileURLToPath(target)} (standalone package)`);
  process.exit(0);
}

await mkdir(target, { recursive: true });
await cp(streamCoreSrc, new URL('core/', target), { recursive: true });
let source = await readFile(streamingServer, 'utf8');
source = source.replace("from 'stream-core'", "from './core/index.mjs'");
const start = source.indexOf('const __dirname =');
const end = source.indexOf('const PORT =', start);
if (start < 0 || end < 0) throw new Error('Gateway environment initialization changed; update the package build.');
source =
  source.slice(0, start) +
  `// Packaged gateway resolves configuration and optional demo files from the caller.\nconst ROOT = process.cwd();\nif (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));\n\n` +
  source.slice(end);
await writeFile(new URL('server.mjs', target), source);
console.log(`Built standalone gateway in ${fileURLToPath(target)}`);
