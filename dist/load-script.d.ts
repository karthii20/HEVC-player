declare const DEFAULT_SCRIPT_URL = "/vendor/avplayer.js";
/**
 * Load the UMD avplayer bundle (and its worker chunks next to it).
 * Workers resolve relative to this script URL, so copy assets into /public first.
 */
export declare function preloadHevcPlayer(scriptUrl?: string): Promise<void>;
export { DEFAULT_SCRIPT_URL };
//# sourceMappingURL=load-script.d.ts.map