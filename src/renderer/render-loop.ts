import { get } from "../stores/settings";
import { getActiveSplines, type SpicySpringConfig } from "./spicy-spring";

// STEP_CAP bounds how much virtual time any *single* visible frame is allowed
// to advance the springs by. This is what keeps motion smooth — without it, a
// single slow real frame (e.g. two lyrics views doing spring math + DOM writes
// in the same tick) shows up as one large, visible jump.
//
// MAX_DEBT bounds how much *unconsumed* real time we're willing to carry
// forward across frames. A slow/jittery burst adds to the debt instead of
// discarding it outright, and it drains at STEP_CAP per tick over the next
// few frames — so short stutters fully catch up (no lasting loss of bounce
// amplitude) without ever showing a jump bigger than STEP_CAP in one frame.
// If the coordinator is *sustainedly* overloaded (never catching up), debt
// saturates at MAX_DEBT and further overflow is dropped, same as before —
// but only as a last resort, not on every frame that runs a bit long.
const STEP_CAP = 1 / 30;
const MAX_DEBT = 1 / 4;

export interface FrameCtx {
  animationStyle: "spicy-bounce" | "wobble";
  glowIntensity: number;
  blurEnabled: boolean;
  blurStrengthMul: number;
  splines: ReturnType<typeof getActiveSplines>;
}

export interface SharedFrame {
  currentTimestamp: number;
  deltaTime: number;
  isPlaying: boolean;
  springConfig: SpicySpringConfig;
  ctx: FrameCtx;
}

type FrameListener = (frame: SharedFrame) => boolean;

class RenderLoopCoordinator {
  private listeners = new Map<symbol, FrameListener>();
  private rafId = 0;
  private lastFrameTime = 0;
  private timeDebt = 0;
  private running = false;

  register(listener: FrameListener): () => void {
    const id = Symbol("frame-listener");
    this.listeners.set(id, listener);
    this.ensureRunning();
    return () => this.unregister(id);
  }

  private unregister(id: symbol): void {
    this.listeners.delete(id);
    if (this.listeners.size === 0) this.stop();
  }

  private ensureRunningInternal(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.timeDebt = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Force the RAF loop to restart if it stopped */
  ensureRunning(): void {
    this.ensureRunningInternal();
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.timeDebt = Math.min(this.timeDebt + Math.max(rawDt, 0), MAX_DEBT);
    const deltaTime = Math.min(this.timeDebt, STEP_CAP);
    this.timeDebt -= deltaTime;

    const blurStrength = get("blurStrength");
    const animationStyle = get("animationStyle");
    const currentTimestamp = Spicetify.Player.getProgress() / 1000;
    const isPlaying = Spicetify.Player.isPlaying();
    const frame: SharedFrame = {
      currentTimestamp,
      deltaTime,
      isPlaying,
      springConfig: { enabled: animationStyle === "spicy-bounce" },
      ctx: {
        animationStyle,
        glowIntensity: get("glowIntensity"),
        blurEnabled: get("blurEnabled"),
        blurStrengthMul: blurStrength === "light" ? 0.5 : blurStrength === "heavy" ? 1.5 : 1,
        splines: getActiveSplines(),
      },
    };

    let anyActive = false;
    for (const [id, listener] of this.listeners) {
      const active = listener(frame);
      if (active) anyActive = true;
    }

    if (!anyActive && this.listeners.size > 0) {
      this.stop();
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}

export const renderLoop = new RenderLoopCoordinator();
