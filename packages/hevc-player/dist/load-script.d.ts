/** @deprecated Legacy public-folder path. Omit scriptUrl to use the bundled player. */
declare const DEFAULT_SCRIPT_URL = "/vendor/avplayer.js";
/**
 * Load the packaged player and workers by default, without public-folder setup.
 * An explicit scriptUrl loads an externally hosted UMD bundle and adjacent chunks.
 */
export declare function preloadHevcPlayer(scriptUrl?: string): Promise<void>;
export { DEFAULT_SCRIPT_URL };
//# sourceMappingURL=load-script.d.ts.map