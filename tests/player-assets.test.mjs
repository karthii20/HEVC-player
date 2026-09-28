import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getBundledAssets } from '../packages/hevc-player/dist/bundled-assets.js';
import { createStreamPlayer } from '../packages/hevc-player/dist/create-player.js';
import { copyHevcPlayerAssets } from '../packages/hevc-player/scripts/copy-assets.mjs';

function setGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

test('importing the package on a server is safe; loading requires a browser', async () => {
  const { preloadHevcPlayer } = await import('../packages/hevc-player/dist/index.js');
  await assert.rejects(preloadHevcPlayer(), /runs in the browser/);
  assert.throws(() => getBundledAssets(), /runs in the browser/);
});

test('bundled decoder URLs contain the exact shipped WASM bytes and are reused', async (t) => {
  setGlobal(t, 'window', {});
  const assets = getBundledAssets();
  assert.equal(getBundledAssets(), assets);
  assert.match(assets.scriptUrl, /^blob:/);
  assert.equal(Object.keys(assets.wasmUrls).length, 5);
  for (const [name, url] of Object.entries(assets.wasmUrls)) {
    assert.match(url, /^blob:/);
    const response = await fetch(url);
    assert.equal(response.headers.get('content-type'), 'application/wasm');
    const actual = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(actual, await readFile(new URL(`../packages/hevc-player/wasm/${name}`, import.meta.url)));
    assert.equal(WebAssembly.validate(actual), true, name);
  }
});

test('default player uses packaged H.264, H.265, AAC and audio processors', async (t) => {
  let config;
  setGlobal(t, 'window', { AVPlayer: class {
    constructor(options) { config = options; }
    async load() {}
    async play() {}
    async destroy() {}
    setVolume() {}
  } });
  setGlobal(t, 'document', { baseURI: 'https://example.test/nested/app/' });
  const player = await createStreamPlayer({}, { url: '/stream' });
  const { wasmUrls } = getBundledAssets();
  assert.equal(config.enableWebCodecs, false);
  assert.equal(config.getWasm('decoder', 27), wasmUrls['h264-simd.wasm']);
  assert.equal(config.getWasm('decoder', 173), wasmUrls['hevc-simd.wasm']);
  assert.equal(config.getWasm('decoder', 86018), wasmUrls['aac-simd.wasm']);
  assert.equal(config.getWasm('resampler'), wasmUrls['resample-simd.wasm']);
  assert.equal(config.getWasm('stretchpitcher'), wasmUrls['stretchpitch-simd.wasm']);
  await player.destroy();
});

test('default script preload shares concurrent loads and retries after failure', async (t) => {
  setGlobal(t, 'window', {});
  const scripts = [];
  const appended = [];
  setGlobal(t, 'document', {
    scripts,
    createElement() {
      const script = new EventTarget();
      script.remove = () => scripts.splice(scripts.indexOf(script), 1);
      return script;
    },
    head: { appendChild(script) { scripts.push(script); appended.push(script); } },
  });
  const { preloadHevcPlayer } = await import('../packages/hevc-player/dist/load-script.js?preload-test');
  const first = preloadHevcPlayer();
  assert.equal(preloadHevcPlayer(), first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /^blob:/);
  scripts[0].dispatchEvent(new Event('error'));
  await assert.rejects(first, /Content Security Policy/);
  assert.equal(scripts.length, 0);
  const retry = preloadHevcPlayer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appended.length, 2);
  window.AVPlayer = class {};
  scripts[0].dispatchEvent(new Event('load'));
  await retry;
  await preloadHevcPlayer();
  assert.equal(appended.length, 2);
});

test('optional copy CLI copies the packaged distribution and license', async (t) => {
  const dest = await mkdtemp(path.join(tmpdir(), 'hevc-assets-'));
  t.after(() => rm(dest, { recursive: true, force: true }));
  await copyHevcPlayerAssets(dest);
  const sourceRoot = new URL('../packages/hevc-player/', import.meta.url);
  for (const directory of ['vendor', 'wasm']) {
    const entries = await readdir(path.join(dest, directory));
    assert.ok(entries.length > 0);
    for (const name of entries) {
      assert.deepEqual(await readFile(path.join(dest, directory, name)), await readFile(new URL(`${directory}/${name}`, sourceRoot)));
    }
  }
  assert.ok((await readdir(path.join(dest, 'vendor'))).includes('COPYING.LGPLv3'));
});

test('npm distribution includes embedded assets and the complete optional static distribution', async (t) => {
  const cache = await mkdtemp(path.join(tmpdir(), 'hevc-pack-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const packageRoot = new URL('../packages/hevc-player/', import.meta.url);
  const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'pack', '--dry-run', '--ignore-scripts', '--json', '--cache', cache,
  ], { cwd: fileURLToPath(packageRoot), encoding: 'utf8' });
  const [{ files }] = JSON.parse(output);
  const included = new Set(files.map(({ path }) => path));
  for (const name of ['dist/bundled-assets.js', 'dist/bundled-assets.d.ts', 'COPYING.LGPLv3']) {
    assert.ok(included.has(name), name);
  }
  for (const directory of ['vendor', 'wasm']) {
    for (const file of await readdir(new URL(`${directory}/`, packageRoot))) {
      assert.ok(included.has(`${directory}/${file}`), `${directory}/${file}`);
    }
  }
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot)));
  assert.equal(manifest.dependencies?.['@libmedia/avplayer'], undefined, 'Consumers must not install the upstream build toolchain');
});
