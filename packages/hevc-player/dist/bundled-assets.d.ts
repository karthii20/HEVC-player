/** Assets included with the package; URLs are created lazily in the browser. */
export declare function getBundledAssets(): {
  scriptUrl: string;
  wasmUrls: Record<string, string>;
};
