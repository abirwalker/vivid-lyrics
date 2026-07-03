import type SimpleBar from "simplebar";

interface ScrollerOptions {
  simpleBar: SimpleBar;
  track: HTMLElement;
  focusRatio?: number;
  mode?: "spring" | "exponential";
  decay?: number;
  stiffness?: number;
  damping?: number;
  manualScrollPauseMs?: number;
}

const MAX_DT = 1 / 8;

export class SmoothLyricsScroller {
  private simpleBar: SimpleBar;
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
  private programmaticScroll = false;
  private resumeTimer: number | null = null;
  private onUserInput: (() => void) | null = null;
  private prevLineCenter = -1;

  constructor(opts: ScrollerOptions) {
    this.simpleBar = opts.simpleBar;
    this.track = opts.track;
    this.focusRatio = opts.focusRatio ?? 0.42;
    this.mode = opts.mode ?? "spring";
    this.decay = opts.decay ?? 10;
    this.stiffness = opts.stiffness ?? 180;
    this.damping = opts.damping ?? 20;
    this.manualPauseMs = opts.manualScrollPauseMs ?? 4000;

    this.bindManualScrollDetection();
  }

  private clampTarget(raw: number): number {
    const scrollEl = this.simpleBar.getScrollElement();
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    return Math.max(0, Math.min(maxScroll, raw));
  }

  setActiveLine(cachedLineCenter: number, cachedContainerHeight: number) {
    if (this.userScrolling) return;
    if (cachedLineCenter === this.prevLineCenter) return;
    this.prevLineCenter = cachedLineCenter;

    const target = this.clampTarget(cachedLineCenter - cachedContainerHeight * this.focusRatio);
    if (Math.abs(this.current - target) < 0.5) return;
    this.target = target;
    if (!this.initialized) {
      this.current = this.target;
      this.velocity = 0;
      this.applyScroll(this.current);
      this.initialized = true;
    }
  }

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

    this.applyScroll(this.current);
  }

  snapToTarget() {
    this.current = this.target;
    this.velocity = 0;
    this.applyScroll(this.current);
  }

  get isUserScrolling() {
    return this.userScrolling;
  }

  getScrollElement(): HTMLElement {
    return this.simpleBar.getScrollElement();
  }

  getContentElement(): HTMLElement {
    return this.simpleBar.getContentElement();
  }

  private applyScroll(pos: number) {
    this.programmaticScroll = true;
    this.simpleBar.getScrollElement().scrollTop = Math.round(pos);
    this.programmaticScroll = false;
  }

  private bindManualScrollDetection() {
    this.onUserInput = () => {
      if (this.programmaticScroll) return;
      this.userScrolling = true;
      if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => {
        this.userScrolling = false;
      }, this.manualPauseMs);
    };
    const scrollEl = this.simpleBar.getScrollElement();
    scrollEl.addEventListener("scroll", this.onUserInput, { passive: true });
  }

  dispose() {
    if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
    if (this.onUserInput) {
      this.simpleBar.getScrollElement().removeEventListener("scroll", this.onUserInput);
    }
  }
}
