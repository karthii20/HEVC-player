/** One retained picture per viewing session; no per-frame readback or encoding. */
export declare function createFrameHold(container: HTMLDivElement): {
    beginAttempt(): {
        rendered(): void;
        freeze(): void;
    };
    destroy(): void;
};
//# sourceMappingURL=frame-hold.d.ts.map