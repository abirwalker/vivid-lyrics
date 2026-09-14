import { get, onSettingsChange } from "../stores/settings";
import { getActiveSplines, type SpicySpringConfig } from "./spicy-spring";
import { getSmoothProgress } from "./playback-clock";
import {
  isPerformanceLoggingEnabled,
  incrementPerformanceCounter,
  recordPerformanceDuration,
  recordPerformanceFrame,
  setPerformanceGauge,
} from "../tools/performance-logger";

export interface FrameCtx {
  animationStyle: "spicy-bounce" | "wobble";
  glowIntensity: number;
  blurEnabled: boolean;
  blurStrengthMul: number;
  splines: ReturnType<typeof getActiveSplines>;
  isCurrentSpring: boolean;
}

export interface SharedFrame {
  currentTimestamp: number;
  deltaTime: number;
  isPlaying: boolean;
  springConfig: SpicySpringConfig;
  ctx: FrameCtx;
}

type FrameListener = (frame: SharedFrame) => boolean;
type RegisteredListener = {
  label: string;
  listener: FrameListener;
};

type AnimationFrameDriver = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

/**
 * Spotify wraps the main window's requestAnimationFrame. Its wrapper performs
 * an OverlayScrollbars environment measurement after callbacks, invalidating
 * the document and synchronously reading scrollWidth. A clean same-origin
 * realm exposes Chromium's native RAF without changing cadence or timestamps.
 */
function createAnimationFrameDriver(): AnimationFrameDriver {
  let realm: HTMLIFrameElement | null = null;
  try {
    realm = document.createElement("iframe");
    realm.setAttribute("aria-hidden", "true");
    realm.tabIndex = -1;
    realm.style.cssText =
      "position:fixed;width:0;height:0;border:0;pointer-events:none;opacity:0";
    document.documentElement.appendChild(realm);

    const frameWindow = realm.contentWindow;
    if (frameWindow) {
      // Take pristine Web API functions from the clean realm, but invoke them
      // with Spotify's main window as their receiver. The callbacks then use
      // the main document's display-rate scheduler rather than the hidden
      // iframe's throttled scheduler.
      const nativeRequest = frameWindow.requestAnimationFrame;
      const nativeCancel = frameWindow.cancelAnimationFrame;
      const request = (callback: FrameRequestCallback): number =>
        Reflect.apply(nativeRequest, window, [callback]) as number;
      const cancel = (handle: number): void => {
        Reflect.apply(nativeCancel, window, [handle]);
      };

      // Verify the cross-realm Window receiver before removing the temporary
      // realm. Chromium accepts this; the fallback below covers other builds.
      const probe = request(() => {});
      cancel(probe);
      realm.remove();
      return {
        request,
        cancel,
      };
    }
  } catch {
    // Fall through to Spotify's main-window implementation when this Chromium
    // build disallows access to a same-origin about:blank realm.
  }
  realm?.remove();

  return {
    request: window.requestAnimationFrame.bind(window),
    cancel: window.cancelAnimationFrame.bind(window),
  };
}

class RenderLoopCoordinator {
  private listeners = new Map<symbol, RegisteredListener>();
  private listenerList: RegisteredListener[] = [];
  private frameDriver: AnimationFrameDriver | null = null;
  private rafId = 0;
  private lastFrameTime = 0;
  private running = false;
  private profiledLabels = new Set<string>();

  private cachedCtx: FrameCtx = {
    animationStyle: "spicy-bounce",
    glowIntensity: 1,
    blurEnabled: true,
    blurStrengthMul: 1,
    splines: getActiveSplines(),
    isCurrentSpring: get("springMode") === "current",
  };

  private cachedSpringConfig: SpicySpringConfig = {
    enabled: true,
  };

  private frame: SharedFrame = {
    currentTimestamp: 0,
    deltaTime: 0,
    isPlaying: false,
    springConfig: this.cachedSpringConfig,
    ctx: this.cachedCtx,
  };

  constructor() {
    this.refreshSettings();
    onSettingsChange((change) => {
      if (
        !change.key ||
        change.key === "animationStyle" ||
        change.key === "glowIntensity" ||
        change.key === "blurEnabled" ||
        change.key === "blurStrength" ||
        change.key === "springMode"
      ) {
        this.refreshSettings();
      }
    });
  }

  private refreshSettings(): void {
    const blurStrength = get("blurStrength");
    const animationStyle = get("animationStyle");
    this.cachedCtx.animationStyle = animationStyle;
    this.cachedCtx.glowIntensity = get("glowIntensity");
    this.cachedCtx.blurEnabled = get("blurEnabled");
    this.cachedCtx.blurStrengthMul =
      blurStrength === "light" ? 0.5 : blurStrength === "heavy" ? 1.5 : 1;
    this.cachedCtx.splines = getActiveSplines();
    this.cachedCtx.isCurrentSpring = get("springMode") === "current";
    this.cachedSpringConfig.enabled = animationStyle === "spicy-bounce";
  }

  register(listener: FrameListener, label = "unknown"): () => void {
    const id = Symbol("frame-listener");
    this.listeners.set(id, { label, listener });
    this.listenerList = Array.from(this.listeners.values());
    this.ensureRunning();
    return () => this.unregister(id);
  }

  private unregister(id: symbol): void {
    this.listeners.delete(id);
    this.listenerList = Array.from(this.listeners.values());
    if (this.listeners.size === 0) this.stop();
  }

  private ensureRunningInternal(): void {
    if (this.running) return;
    this.running = true;
    incrementPerformanceCounter("renderLoop.starts");
    this.lastFrameTime = performance.now();
    this.frameDriver ??= createAnimationFrameDriver();
    this.rafId = this.frameDriver.request(this.tick);
  }

  /** Force the RAF loop to restart if it stopped */
  ensureRunning(): void {
    this.ensureRunningInternal();
  }

  private stop(): void {
    this.running = false;
    incrementPerformanceCounter("renderLoop.stops");
    this.frameDriver?.cancel(this.rafId);
    setPerformanceGauge("renderLoop.running", 0);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    const deltaTime = Math.max((now - this.lastFrameTime) / 1000, 0);
    this.lastFrameTime = now;
    const profiling = isPerformanceLoggingEnabled();
    const loopStartedAt = profiling ? performance.now() : 0;
    const setupStartedAt = loopStartedAt;
    if (profiling) recordPerformanceFrame(now);

    const isPlaying = Spicetify.Player.isPlaying();
    const currentTimestamp = getSmoothProgress(isPlaying);

    this.frame.currentTimestamp = currentTimestamp;
    this.frame.deltaTime = deltaTime;
    this.frame.isPlaying = isPlaying;

    if (profiling) {
      recordPerformanceDuration("renderLoop.setup", performance.now() - setupStartedAt);
    }

    let anyActive = false;
    const labelCounts = profiling ? new Map<string, number>() : null;
    const list = this.listenerList;
    for (let i = 0; i < list.length; i++) {
      const { label, listener } = list[i];
      const listenerStartedAt = profiling ? performance.now() : 0;
      const active = listener(this.frame);
      if (profiling) {
        recordPerformanceDuration(`renderer.${label}`, performance.now() - listenerStartedAt);
        labelCounts!.set(label, (labelCounts!.get(label) ?? 0) + 1);
      }
      if (active) anyActive = true;
    }

    if (profiling) {
      setPerformanceGauge("renderLoop.running", 1);
      setPerformanceGauge("renderLoop.listeners", this.listeners.size);
      for (const label of this.profiledLabels) {
        if (!labelCounts!.has(label)) setPerformanceGauge(`renderers.${label}`, 0);
      }
      for (const [label, count] of labelCounts!) {
        setPerformanceGauge(`renderers.${label}`, count);
      }
      this.profiledLabels = new Set(labelCounts!.keys());
      recordPerformanceDuration("renderLoop.total", performance.now() - loopStartedAt);
    }

    if (!anyActive && this.listeners.size > 0) {
      this.stop();
      return;
    }

    this.rafId = this.frameDriver!.request(this.tick);
  };
}

export const renderLoop = new RenderLoopCoordinator();
