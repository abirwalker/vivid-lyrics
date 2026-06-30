import { setCachedStyle } from "../utils/style-cache";

interface ScrollerOptions {
  container: HTMLElement;
  track: HTMLElement;
  focusRatio?: number;
  mode?: "spring" | "exponential";
  decay?: number;
  stiffness?: number;
  damping?: number;
  manualScrollPauseMs?: number;
}

const MAX_DT = 1 / 30;

export class SmoothLyricsScroller {
  private container: HTMLElement;
  private track: HTMLElement;
  private focusRatio: number;
  private mode: "spring" | "exponential";
  private decay: number;
  private stiffness: number;
  private damping: number;
  private manualPauseMs: number;

  private current = 0;
  private target = 0;
  private velocity = 0;
  private initialized = false;

  private userScrolling = false;
  private resumeTimer: number | null = null;
  private onUserInput: (() => void) | null = null;
  private prevActiveLine: HTMLElement | null = null;

  private resizeObserver: ResizeObserver | null = null;

  constructor(opts: ScrollerOptions) {
    this.container = opts.container;
    this.track = opts.track;
    this.focusRatio = opts.focusRatio ?? 0.42;
    this.mode = opts.mode ?? "spring";
    this.decay = opts.decay ?? 10;
    this.stiffness = opts.stiffness ?? 180;
    this.damping = opts.damping ?? 20;
    this.manualPauseMs = opts.manualScrollPauseMs ?? 4000;

    this.bindManualScrollDetection();
    this.observeResize();
  }

  private observeResize() {
    this.resizeObserver = new ResizeObserver(() => {});
    this.resizeObserver.observe(this.container);
  }

  private clampTarget(raw: number): number {
    const minY = Math.min(
      0,
      this.container.clientHeight - this.track.scrollHeight,
    );
    return Math.max(minY, Math.min(0, raw));
  }

  /** Call when the active line element changes. */
  setActiveLine(lineEl: HTMLElement) {
    if (this.userScrolling) return;
    if (lineEl === this.prevActiveLine) return;
    this.prevActiveLine = lineEl;

    const lineCenter = lineEl.offsetTop + lineEl.offsetHeight / 2;
    const focusOffset = this.container.clientHeight * this.focusRatio;
    this.target = this.clampTarget(-(lineCenter - focusOffset));

    if (!this.initialized) {
      this.current = this.target;
      this.velocity = 0;
      setCachedStyle(this.track, "transform", `translate3d(0,${this.current}px,0)`);
      this.initialized = true;
    }
  }

  /** Drive from master RAF loop. dt in seconds. */
  update(dt: number) {
    if (this.current === this.target) return;
    dt = Math.min(dt, MAX_DT);

    if (this.mode === "exponential") {
      const t = 1 - Math.exp(-this.decay * dt);
      this.current += (this.target - this.current) * t;
    } else {
      const force = (this.target - this.current) * this.stiffness;
      this.velocity = (this.velocity + force * dt) * Math.exp(-this.damping * dt);
      this.current += this.velocity * dt;
    }

    if (Math.abs(this.target - this.current) < 0.05 && Math.abs(this.velocity) < 0.01) {
      this.current = this.target;
      this.velocity = 0;
    }

    setCachedStyle(this.track, "transform", `translate3d(0,${this.current}px,0)`);
  }

  /** Snap instantly to active line (for seek/skip). */
  snapToTarget() {
    this.current = this.target;
    this.velocity = 0;
    setCachedStyle(this.track, "transform", `translate3d(0,${this.current}px,0)`);
  }

  get isUserScrolling() {
    return this.userScrolling;
  }

  private bindManualScrollDetection() {
    this.onUserInput = () => {
      this.userScrolling = true;
      if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => {
        this.userScrolling = false;
      }, this.manualPauseMs);
    };
    this.container.addEventListener("wheel", this.onUserInput, { passive: true });
    this.container.addEventListener("touchstart", this.onUserInput, { passive: true });
    this.container.addEventListener("pointerdown", this.onUserInput, { passive: true });
  }

  dispose() {
    this.resizeObserver?.disconnect();
    if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
    if (this.onUserInput) {
      this.container.removeEventListener("wheel", this.onUserInput);
      this.container.removeEventListener("touchstart", this.onUserInput);
      this.container.removeEventListener("pointerdown", this.onUserInput);
    }
  }
}
