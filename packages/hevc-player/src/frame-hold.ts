/** One retained picture per viewing session; no per-frame readback or encoding. */
export function createFrameHold(container: HTMLDivElement) {
  let held: HTMLCanvasElement | undefined;
  let releaseFrame: number | undefined;
  let disposed = false;
  let previousPosition: string | undefined;

  function cancelRelease() {
    if (releaseFrame !== undefined) cancelAnimationFrame(releaseFrame);
    releaseFrame = undefined;
  }

  return {
    beginAttempt() {
      let rendered = false;
      let interrupted = false;
      return {
        rendered() {
          if (disposed || interrupted) return;
          rendered = true;
          if (!held) return;
          cancelRelease();
          // Worker rendering and DOM presentation happen on different clocks.
          // Keep the old picture through the first browser paint of the new one.
          releaseFrame = requestAnimationFrame(() => {
            releaseFrame = requestAnimationFrame(() => {
              releaseFrame = undefined;
              held?.remove();
              held = undefined;
            });
          });
        },
        freeze() {
          interrupted = true;
          cancelRelease();
          if (disposed || held || !rendered || typeof container.querySelector !== "function") return;
          const source = container.querySelector("canvas");
          if (!source?.width || !source.height) return;
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const context = copy.getContext("2d");
          if (!context) return;
          try {
            context.drawImage(source, 0, 0);
          } catch {
            return; // Unavailable/lost render contexts must not prevent recovery.
          }
          copy.dataset.hevcHeldFrame = "true";
          copy.setAttribute("aria-hidden", "true");
          Object.assign(copy.style, {
            position: "absolute", inset: "0", width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "1",
          });
          if (getComputedStyle(container).position === "static") {
            previousPosition = container.style.position;
            container.style.position = "relative";
          }
          container.appendChild(copy);
          held = copy;
        },
      };
    },
    destroy() {
      disposed = true;
      cancelRelease();
      held?.remove();
      held = undefined;
      if (previousPosition !== undefined && container.style.position === "relative") {
        container.style.position = previousPosition;
      }
    },
  };
}
