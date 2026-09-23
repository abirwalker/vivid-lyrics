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
  onScrollApplied?: (scrollTop: number) => void;
}

const MAX_DT = 1 / 8;
const SCROLL_SUBPIXEL_STEPS = 8;
const MIN_BOUNCE_TRAVEL_PX = 12;
const MIN_BOUNCE_VELOCITY_PX_S = 64;

function quantizeScrollTop(value: number): number {
  return Math.round(value * SCROLL_SUBPIXEL_STEPS) / SCROLL_SUBPIXEL_STEPS;
}

export class SmoothLyricsScroller {
  private simpleBar: SimpleBar;
  private track: HTMLElement;
  private focusRatio: number;
  private mode: "spring" | "exponential";
  private decay: number;
  private stiffness: number;
  private damping: number;
  private manualPauseMs: number;
  private onScrollApplied?: (scrollTop: number) => void;

  private current = 0;
  private target = 0;
  private velocity = 0;
  private crossedTarget = false;
  private bounceEnabled = false;
  private initialized = false;

  private userScrolling = false;
  private programmaticScroll = false;
  private resumeTimer: number | null = null;
  private onUserInput: (() => void) | null = null;
  private onProgrammaticScroll: ((event: Event) => void) | null = null;
  private lastAppliedScrollTop = Number.NaN;
  private pendingProgrammaticScrollTop: number | null = null;
  private maxScroll = 0;

  constructor(opts: ScrollerOptions) {
    this.simpleBar = opts.simpleBar;
    this.track = opts.track;
    this.focusRatio = opts.focusRatio ?? 0.42;
    this.mode = opts.mode ?? "spring";
    this.decay = opts.decay ?? 10;
    this.stiffness = opts.stiffness ?? 180;
    this.damping = opts.damping ?? 20;
    this.manualPauseMs = opts.manualScrollPauseMs ?? 4000;
    this.onScrollApplied = opts.onScrollApplied;

    this.bindProgrammaticScrollIsolation();
    this.bindManualScrollDetection();
  }

  private clampTarget(raw: number, maxScroll: number): number {
    return Math.max(0, Math.min(maxScroll, raw));
  }

  setActiveLine(
    cachedLineCenter: number,
    cachedContainerHeight: number,
    cachedMaxScroll: number,
  ) {
    this.maxScroll = cachedMaxScroll;
    const target = this.clampTarget(
      cachedLineCenter - cachedContainerHeight * this.focusRatio,
      cachedMaxScroll,
    );
    if (target !== this.target) {
      this.crossedTarget = false;
      this.bounceEnabled = Math.abs(target - this.current) >= MIN_BOUNCE_TRAVEL_PX;
    }
    this.target = target;
    if (this.userScrolling) return;
    if (!this.initialized) {
      this.current = this.target;
      this.velocity = 0;
      this.bounceEnabled = false;
      this.applyScroll(this.current);
      this.initialized = true;
    }
  }

  syncPosition(pos: number) {
    this.current = pos;
    this.velocity = 0;
    this.crossedTarget = false;
    this.bounceEnabled = false;
    this.lastAppliedScrollTop = quantizeScrollTop(pos);
    this.pendingProgrammaticScrollTop = null;
  }

  update(dt: number) {
    if (this.current === this.target) return;
    dt = Math.min(dt, MAX_DT);

    if (this.mode === "exponential") {
      const t = 1 - Math.exp(-this.decay * dt);
      this.current += (this.target - this.current) * t;
    } else {
      const distanceBeforeStep = this.target - this.current;
      const force = (this.target - this.current) * this.stiffness;
      this.velocity = (this.velocity + force * dt) * Math.exp(-this.damping * dt);
      this.current += this.velocity * dt;

      const distanceAfterStep = this.target - this.current;
      if (
        distanceBeforeStep !== 0 &&
        Math.sign(distanceBeforeStep) !== Math.sign(distanceAfterStep)
      ) {
        if (!this.bounceEnabled || this.crossedTarget) {
          this.current = this.target;
          this.velocity = 0;
          this.crossedTarget = false;
          this.bounceEnabled = false;
        } else {
          this.crossedTarget = true;
          if (Math.abs(this.velocity) < MIN_BOUNCE_VELOCITY_PX_S) {
            this.velocity = Math.sign(this.velocity) * MIN_BOUNCE_VELOCITY_PX_S;
          }
        }
      }
    }

    if (Math.abs(this.target - this.current) < 0.05 && Math.abs(this.velocity) < 0.01) {
      this.current = this.target;
      this.velocity = 0;
      this.crossedTarget = false;
      this.bounceEnabled = false;
    }

    this.applyScroll(this.current);
  }

  snapToTarget() {
    this.current = this.target;
    this.velocity = 0;
    this.crossedTarget = false;
    this.bounceEnabled = false;
    this.applyScroll(this.current);
  }

  get isUserScrolling() {
    return this.userScrolling;
  }

  getScrollElement(): HTMLElement {
    return this.simpleBar.getScrollElement()!;
  }

  getContentElement(): HTMLElement {
    return this.simpleBar.getContentElement()!;
  }

  private applyScroll(pos: number) {
    const scrollTop = quantizeScrollTop(pos);
    if (scrollTop === this.lastAppliedScrollTop) return;
    this.lastAppliedScrollTop = scrollTop;
    this.programmaticScroll = true;
    this.pendingProgrammaticScrollTop = scrollTop;
    this.onScrollApplied?.(scrollTop);
    this.getScrollElement().scrollTop = scrollTop;
    this.programmaticScroll = false;
  }

  private bindProgrammaticScrollIsolation() {
    const scrollEl = this.getScrollElement();
    this.onProgrammaticScroll = (event: Event) => {
      if (event.target !== scrollEl) return;
      const expected = this.pendingProgrammaticScrollTop;
      if (expected === null) return;

      const actual = scrollEl.scrollTop;
      if (Math.abs(actual - expected) > 0.5) {
        this.pendingProgrammaticScrollTop = null;
        return;
      }

      event.stopImmediatePropagation();
      this.pendingProgrammaticScrollTop = null;
      this.positionScrollbarFromCache(actual);
    };
    window.addEventListener("scroll", this.onProgrammaticScroll, {
      capture: true,
      passive: true,
    });
  }

  private positionScrollbarFromCache(scrollTop: number) {
    const axis = this.simpleBar.axis.y;
    const trackSize = Number(axis.track.size);
    const scrollbarSize = Number(axis.scrollbar.size);
    const scrollbar = axis.scrollbar.el;
    if (
      !scrollbar ||
      this.maxScroll <= 0 ||
      !Number.isFinite(trackSize) ||
      !Number.isFinite(scrollbarSize)
    ) return;

    const scrollRatio = Math.max(0, Math.min(1, scrollTop / this.maxScroll));
    const handleOffset = Math.trunc((trackSize - scrollbarSize) * scrollRatio);
    scrollbar.style.transform = `translate3d(0, ${handleOffset}px, 0)`;
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
    const scrollEl = this.getScrollElement();
    scrollEl.addEventListener("scroll", this.onUserInput, { passive: true });
  }

  dispose() {
    if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
    if (this.onUserInput) {
      this.getScrollElement().removeEventListener("scroll", this.onUserInput);
    }
    if (this.onProgrammaticScroll) {
      window.removeEventListener("scroll", this.onProgrammaticScroll, true);
    }
  }
}
