import { get } from "../stores/settings";
import { getActiveSplines, type SpicySpringConfig } from "./spicy-spring";

const MAX_DT = 1 / 30;

export interface FrameCtx {
  springEnabled: boolean;
  glowIntensity: number;
  blurEnabled: boolean;
  blurStrengthMul: number;
  splines: ReturnType<typeof getActiveSplines>;
}

export interface SharedFrame {
  currentTimestamp: number;
  deltaTime: number;
  springConfig: SpicySpringConfig;
  ctx: FrameCtx;
}

type FrameListener = (frame: SharedFrame) => void;

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

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    const rawDt = (now - this.lastFrameTime) / 1000;
    const deltaTime = Math.min(Math.max(rawDt, 0), MAX_DT);
    this.lastFrameTime = now;

    const blurStrength = get("blurStrength");
    const frame: SharedFrame = {
      currentTimestamp: Spicetify.Player.getProgress() / 1000,
      deltaTime,
      springConfig: { enabled: get("springEnabled") },
      ctx: {
        springEnabled: get("springEnabled"),
        glowIntensity: get("glowIntensity"),
        blurEnabled: get("blurEnabled"),
        blurStrengthMul: blurStrength === "light" ? 0.5 : blurStrength === "heavy" ? 1.5 : 1,
        splines: getActiveSplines(),
      },
    };

    for (const listener of Array.from(this.listeners.values())) {
      listener(frame);
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}

export const renderLoop = new RenderLoopCoordinator();
