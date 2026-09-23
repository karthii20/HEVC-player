#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copy the UMD player, worker chunks, LGPL license, and H.264 / H.265 WASM
 * into a web-accessible folder (usually `public`).
 */
export async function copyHevcPlayerAssets(destRoot = "public") {
  const avplayerJs = require.resolve("@libmedia/avplayer");
  const distDir = path.dirname(path.dirname(avplayerJs));
  const packageRoot = path.dirname(distDir);
  const umdDir = path.join(distDir, "umd");
  const license = path.join(packageRoot, "COPYING.LGPLv3");
  const wasmDir = path.join(here, "../wasm");
  const dest = path.resolve(destRoot);

  await mkdir(path.join(dest, "vendor"), { recursive: true });
  await mkdir(path.join(dest, "wasm"), { recursive: true });
  await cp(umdDir, path.join(dest, "vendor"), { recursive: true });
  await cp(license, path.join(dest, "vendor/COPYING.LGPLv3"));
  await cp(path.join(wasmDir, "hevc-simd.wasm"), path.join(dest, "wasm/hevc-simd.wasm"));
  await cp(path.join(wasmDir, "h264-simd.wasm"), path.join(dest, "wasm/h264-simd.wasm"));
  console.log(`Copied H.264/H.265 player assets to ${dest}/vendor and ${dest}/wasm`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  await copyHevcPlayerAssets(process.argv[2] || "public");
}
