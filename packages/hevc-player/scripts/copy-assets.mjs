#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copy the UMD player, worker chunks, LGPL license, and video/audio WASM
 * into a web-accessible folder (usually `public`).
 */
export async function copyHevcPlayerAssets(destRoot = "public") {
  const umdDir = path.join(here, "../vendor");
  const wasmDir = path.join(here, "../wasm");
  const dest = path.resolve(destRoot);

  await mkdir(path.join(dest, "vendor"), { recursive: true });
  await mkdir(path.join(dest, "wasm"), { recursive: true });
  await cp(umdDir, path.join(dest, "vendor"), { recursive: true });
  for (const file of ["hevc-simd.wasm", "h264-simd.wasm", "aac-simd.wasm", "resample-simd.wasm", "stretchpitch-simd.wasm"]) {
    await cp(path.join(wasmDir, file), path.join(dest, "wasm", file));
  }
  console.log(`Copied H.264/H.265 + AAC player assets to ${dest}/vendor and ${dest}/wasm`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  await copyHevcPlayerAssets(process.argv[2] || "public");
}
