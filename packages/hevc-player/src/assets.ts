/** Ordinary dynamic import works in bundlers and when dist is served as native ESM. */
export async function loadBundledAssets() {
  const { getBundledAssets } = await import("./bundled-assets.js");
  return getBundledAssets();
}
