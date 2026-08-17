import { get } from "../stores/settings";
import { getActiveSplines, type SpicySpringConfig } from "./spicy-spring";
import { getSmoothProgress } from "./playback-clock";

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

    // Advance once by the real elapsed time, as Spicy Lyrics does. Carrying a
    // stalled frame forward as debt makes several later frames run the spring
    // simulation faster than real time, producing a visible slow/fast recovery.
    const deltaTime = Math.max((now - this.lastFrameTime) / 1000, 0);
    this.lastFrameTime = now;

    const blurStrength = get("blurStrength");
    const animationStyle = get("animationStyle");
    const isPlaying = Spicetify.Player.isPlaying();
    const currentTimestamp = getSmoothProgress(isPlaying);
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
    for (const listener of this.listeners.values()) {
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
