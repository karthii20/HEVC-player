import { loadBundledAssets } from "./assets.js";
/** @deprecated Legacy public-folder path. Omit scriptUrl to use the bundled player. */
const DEFAULT_SCRIPT_URL = "/vendor/avplayer.js";
let pending = null;
/**
 * Load the packaged player and workers by default, without public-folder setup.
 * An explicit scriptUrl loads an externally hosted UMD bundle and adjacent chunks.
 */
export function preloadHevcPlayer(scriptUrl) {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("hevc-player runs in the browser."));
    }
    if (window.AVPlayer)
        return Promise.resolve();
    if (pending)
        return pending;
    pending = (scriptUrl ? Promise.resolve(scriptUrl) : loadBundledAssets().then((assets) => assets.scriptUrl))
        .then(loadScript)
        .catch((error) => {
        pending = null;
        throw error;
    });
    return pending;
}
function loadScript(scriptUrl) {
    return new Promise((resolve, reject) => {
        const fail = (message) => {
            reject(new Error(message));
        };
        const finish = () => {
            if (window.AVPlayer)
                resolve();
            else
                fail("Player script loaded but AVPlayer is missing.");
        };
        const existing = Array.from(document.scripts).find((script) => script.src === scriptUrl);
        if (existing) {
            existing.addEventListener("load", finish, { once: true });
            existing.addEventListener("error", () => {
                existing.remove();
                fail(missingAssetsMessage(scriptUrl));
            }, { once: true });
            if (window.AVPlayer)
                finish();
            return;
        }
        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = true;
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", () => {
            script.remove();
            fail(missingAssetsMessage(scriptUrl));
        }, { once: true });
        document.head.appendChild(script);
    });
}
function missingAssetsMessage(scriptUrl) {
    return scriptUrl.startsWith("blob:")
        ? "Bundled player could not load. Check that your Content Security Policy allows blob: scripts and workers."
        : `Player script could not load from ${scriptUrl}. Check the scriptUrl and its adjacent worker chunks.`;
}
export { DEFAULT_SCRIPT_URL };
//# sourceMappingURL=load-script.js.map