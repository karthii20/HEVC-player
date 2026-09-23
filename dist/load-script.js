const DEFAULT_SCRIPT_URL = "/vendor/avplayer.js";
let pending = null;
/**
 * Load the UMD avplayer bundle (and its worker chunks next to it).
 * Workers resolve relative to this script URL, so copy assets into /public first.
 */
export function preloadHevcPlayer(scriptUrl = DEFAULT_SCRIPT_URL) {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("hevc-player runs in the browser."));
    }
    if (window.AVPlayer)
        return Promise.resolve();
    if (pending)
        return pending;
    pending = new Promise((resolve, reject) => {
        const fail = (message) => {
            pending = null;
            reject(new Error(message));
        };
        const finish = () => {
            if (window.AVPlayer)
                resolve();
            else
                fail("Player script loaded but AVPlayer is missing.");
        };
        const existing = document.querySelector(`script[src="${scriptUrl}"]`);
        if (existing) {
            existing.addEventListener("load", finish, { once: true });
            existing.addEventListener("error", () => fail(missingAssetsMessage()), { once: true });
            if (window.AVPlayer)
                finish();
            return;
        }
        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = true;
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", () => fail(missingAssetsMessage()), { once: true });
        document.head.appendChild(script);
    });
    return pending;
}
function missingAssetsMessage() {
    return "Player assets missing. Run `npx hevc-player-copy-assets public` (or npm run setup in HEVC Studio).";
}
export { DEFAULT_SCRIPT_URL };
//# sourceMappingURL=load-script.js.map