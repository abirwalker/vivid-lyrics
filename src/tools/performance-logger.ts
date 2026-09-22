/** Opt-in runtime diagnostics for renderer and browser frame performance. */
import { get, onSettingsChange } from "../stores/settings";

type TimingStat = {
  calls: number;
  totalMs: number;
  maxMs: number;
};

type LongAnimationFrameScript = {
  startTimeMs: number;
  executionStartMs: number;
  durationMs: number;
  forcedStyleAndLayoutMs: number;
  invoker: string;
  invokerType: string;
  sourceURL: string;
  sourceCharPosition: number;
  functionName: string;
};

type PerformanceEventMark = {
  name: string;
  atMs: number;
};

type CssMotionSample = {
  atMs: number;
  kind: "transition" | "animation";
  name: string;
  target: string;
  vivid: boolean;
};

type LongAnimationFrameSample = {
  startTimeMs: number;
  durationMs: number;
  blockingDurationMs: number;
  forcedStyleAndLayoutMs: number;
  scripts: LongAnimationFrameScript[];
  nearbyEvents: Array<PerformanceEventMark & { offsetMs: number }>;
};

type PerformanceScriptTimingLike = PerformanceEntry & {
  executionStart?: number;
  forcedStyleAndLayoutDuration?: number;
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceCharPosition?: number;
  sourceFunctionName?: string;
};

type LongAnimationFrameEntryLike = PerformanceEntry & {
  blockingDuration?: number;
  scripts?: PerformanceScriptTimingLike[];
};

export type PerformanceSnapshot = {
  enabled: boolean;
  windowSeconds: number;
  frames: {
    count: number;
    fps: number;
    averageIntervalMs: number;
    p95IntervalMs: number;
    estimatedBudgetMs: number;
    estimatedDroppedFrames: number;
    estimatedDropEvents: number;
    estimatedDropRatePercent: number;
    estimatedDelayedFrames: number;
  };
  timings: Record<string, {
    calls: number;
    callsPerSecond: number;
    averageMs: number;
    maxMs: number;
    totalMs: number;
  }>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  longAnimationFrames: LongAnimationFrameSample[];
  cssMotion: CssMotionSample[];
  dom: Record<string, number>;
  heapMb: number | null;
};

const REPORT_INTERVAL_MS = 5000;
const MAX_FRAME_SAMPLES = 2000;
const MAX_LONG_ANIMATION_FRAME_SAMPLES = 8;
const MAX_SCRIPTS_PER_FRAME = 5;
const MAX_CSS_MOTION_SAMPLES = 200;
const MAX_EVENT_MARKS = 500;
const EVENT_MARK_RETENTION_MS = 10000;
const EVENT_CORRELATION_LEAD_MS = 20;

let enabled = false;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let longAnimationFrameObserver: PerformanceObserver | null = null;
let cssMotionListenersBound = false;
let windowStartedAt = performance.now();
let lastFrameAt = 0;
let lastCompletedSnapshot: PerformanceSnapshot | null = null;

const timings = new Map<string, TimingStat>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
let frameIntervals: number[] = [];
let longAnimationFrames: LongAnimationFrameSample[] = [];
let eventMarks: PerformanceEventMark[] = [];
let cssMotion: CssMotionSample[] = [];

function percentile(sorted: number[], ratio: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function domSnapshot(): Record<string, number> {
  return {
    renderers: document.querySelectorAll(".LyricsScrollContainer").length,
    lyricLines: document.querySelectorAll(".VocalsGroup").length,
    syllables: document.querySelectorAll(".Syllable").length,
    letters: document.querySelectorAll(".Letter").length,
    fluidBackgrounds: document.querySelectorAll(".VL-FluidMeshBg").length,
    playerWidgets: document.querySelectorAll(".VL-PlayerWidget").length,
  };
}

function heapMegabytes(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return typeof memory?.usedJSHeapSize === "number"
    ? memory.usedJSHeapSize / (1024 * 1024)
    : null;
}

function timingSnapshot(windowSeconds: number): PerformanceSnapshot["timings"] {
  const result: PerformanceSnapshot["timings"] = {};
  for (const [name, stat] of timings) {
    result[name] = {
      calls: stat.calls,
      callsPerSecond: stat.calls / windowSeconds,
      averageMs: stat.calls ? stat.totalMs / stat.calls : 0,
      maxMs: stat.maxMs,
      totalMs: stat.totalMs,
    };
  }
  return result;
}

function mapSnapshot(source: Map<string, number>): Record<string, number> {
  return Object.fromEntries(source.entries());
}

function estimateFrameLoss(intervals: number[], budgetMs: number): {
  droppedFrames: number;
  dropEvents: number;
  dropRatePercent: number;
  delayedFrames: number;
} {
  if (budgetMs <= 0 || !intervals.length) {
    return { droppedFrames: 0, dropEvents: 0, dropRatePercent: 0, delayedFrames: 0 };
  }

  const delayedThreshold = budgetMs * 1.5;
  let droppedFrames = 0;
  let dropEvents = 0;
  let delayedFrames = 0;

  for (const interval of intervals) {
    if (interval > delayedThreshold) delayedFrames++;

    const missedFrames = Math.max(0, Math.round(interval / budgetMs) - 1);
    if (missedFrames === 0) continue;
    droppedFrames += missedFrames;
    dropEvents++;
  }

  const expectedFrames = intervals.length + droppedFrames;
  return {
    droppedFrames,
    dropEvents,
    dropRatePercent: expectedFrames > 0 ? (droppedFrames / expectedFrames) * 100 : 0,
    delayedFrames,
  };
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  const now = performance.now();
  const windowSeconds = Math.max((now - windowStartedAt) / 1000, 0.001);
  const sortedIntervals = [...frameIntervals].sort((a, b) => a - b);
  const estimatedBudgetMs = percentile(sortedIntervals, 0.2);
  const totalInterval = frameIntervals.reduce((sum, value) => sum + value, 0);
  const frameLoss = estimateFrameLoss(frameIntervals, estimatedBudgetMs);

  return {
    enabled,
    windowSeconds,
    frames: {
      count: frameIntervals.length,
      fps: frameIntervals.length / windowSeconds,
      averageIntervalMs: frameIntervals.length ? totalInterval / frameIntervals.length : 0,
      p95IntervalMs: percentile(sortedIntervals, 0.95),
      estimatedBudgetMs,
      estimatedDroppedFrames: frameLoss.droppedFrames,
      estimatedDropEvents: frameLoss.dropEvents,
      estimatedDropRatePercent: frameLoss.dropRatePercent,
      estimatedDelayedFrames: frameLoss.delayedFrames,
    },
    timings: timingSnapshot(windowSeconds),
    counters: mapSnapshot(counters),
    gauges: mapSnapshot(gauges),
    longAnimationFrames: [...longAnimationFrames],
    cssMotion: [...cssMotion],
    dom: domSnapshot(),
    heapMb: heapMegabytes(),
  };
}

function resetWindow(): void {
  timings.clear();
  counters.clear();
  frameIntervals = [];
  longAnimationFrames = [];
  cssMotion = [];
  windowStartedAt = performance.now();
}

function resetPerformanceData(): void {
  lastCompletedSnapshot = null;
  gauges.clear();
  eventMarks = [];
  resetWindow();
}

function rounded(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function reportPerformance(): PerformanceSnapshot {
  markPerformanceEvent("diagnostics.report");
  const snapshot = getPerformanceSnapshot();
  lastCompletedSnapshot = snapshot;
  const timingRows = Object.entries(snapshot.timings)
    .map(([name, stat]) => ({
      name,
      "calls/s": rounded(stat.callsPerSecond, 1),
      "avg ms": rounded(stat.averageMs, 3),
      "max ms": rounded(stat.maxMs, 3),
      "total ms": rounded(stat.totalMs, 1),
    }))
    .sort((a, b) => b["total ms"] - a["total ms"]);

  console.groupCollapsed(
    `[Vivid Lyrics Perf] ${snapshot.windowSeconds.toFixed(1)}s | ` +
    `${snapshot.frames.fps.toFixed(1)} RAF/s | p95 ${snapshot.frames.p95IntervalMs.toFixed(2)}ms | ` +
    `[Estimated] | ${snapshot.frames.estimatedDroppedFrames} Dropped | ` +
    `${snapshot.frames.estimatedDelayedFrames} Delayed`,
  );
  if (timingRows.length) console.table(timingRows);
  console.table({
    ...snapshot.gauges,
    ...snapshot.counters,
    ...snapshot.dom,
    heapMb: snapshot.heapMb === null ? "unavailable" : rounded(snapshot.heapMb, 1),
    estimatedFrameBudgetMs: rounded(snapshot.frames.estimatedBudgetMs, 2),
    estimatedDroppedFrames: snapshot.frames.estimatedDroppedFrames,
    estimatedDropEvents: snapshot.frames.estimatedDropEvents,
    estimatedDropRatePercent: rounded(snapshot.frames.estimatedDropRatePercent, 2),
    estimatedDelayedFrames: snapshot.frames.estimatedDelayedFrames,
  });
  if (snapshot.longAnimationFrames.length) {
    console.table(snapshot.longAnimationFrames.map((frame) => {
      const topScript = frame.scripts[0];
      return {
        "frame ms": rounded(frame.durationMs, 1),
        "blocking ms": rounded(frame.blockingDurationMs, 1),
        "forced layout ms": rounded(frame.forcedStyleAndLayoutMs, 1),
        invoker: topScript?.invoker || "unattributed",
        function: topScript?.functionName || "",
        source: topScript
          ? `${topScript.sourceURL || "unknown"}:${topScript.sourceCharPosition}`
          : "",
      };
    }));
  }
  if (snapshot.cssMotion.length) {
    const motionRows = new Map<string, number>();
    for (const motion of snapshot.cssMotion) {
      const key = `${motion.vivid ? "Vivid" : "Spotify"} | ${motion.kind} | ${motion.name} | ${motion.target}`;
      motionRows.set(key, (motionRows.get(key) ?? 0) + 1);
    }
    console.table(
      [...motionRows.entries()]
        .map(([motion, starts]) => ({ motion, starts }))
        .sort((a, b) => b.starts - a.starts),
    );
  }
  console.log("Full snapshot:", snapshot);
  console.groupEnd();

  resetWindow();
  return snapshot;
}

function buildExportPayload(): Record<string, unknown> {
  const snapshot = lastCompletedSnapshot ?? getPerformanceSnapshot();
  return {
    capturedAt: new Date().toISOString(),
    source: lastCompletedSnapshot ? "latest-complete-window" : "current-partial-window",
    context: {
      route: location.pathname,
      visibility: document.visibilityState,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      playing: Spicetify.Player?.isPlaying?.() ?? false,
      trackUri: Spicetify.Player?.data?.item?.uri ?? null,
    },
    performance: snapshot,
  };
}

export async function copyLatestPerformanceReport(): Promise<void> {
  const text = JSON.stringify(buildExportPayload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard access was denied");
  }
}

function captureLongAnimationFrame(entry: LongAnimationFrameEntryLike): void {
  const allScripts = (entry.scripts ?? []).map((script): LongAnimationFrameScript => ({
      startTimeMs: script.startTime,
      executionStartMs: script.executionStart ?? script.startTime,
      durationMs: script.duration,
      forcedStyleAndLayoutMs: script.forcedStyleAndLayoutDuration ?? 0,
      invoker: script.invoker ?? "",
      invokerType: script.invokerType ?? "",
      sourceURL: script.sourceURL ?? "",
      sourceCharPosition: script.sourceCharPosition ?? -1,
      functionName: script.sourceFunctionName ?? "",
    }));
  const forcedStyleAndLayoutMs = allScripts.reduce(
    (total, script) => total + script.forcedStyleAndLayoutMs,
    0,
  );
  const scripts = allScripts
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, MAX_SCRIPTS_PER_FRAME);

  recordPerformanceDuration("browser.longAnimationFrame", entry.duration);
  if (forcedStyleAndLayoutMs > 0) {
    recordPerformanceDuration("browser.forcedStyleAndLayout", forcedStyleAndLayoutMs);
  }
  incrementPerformanceCounter("browser.longAnimationFrames");
  const frameEnd = entry.startTime + entry.duration;
  const nearbyEvents = eventMarks
    .filter((mark) => (
      mark.atMs >= entry.startTime - EVENT_CORRELATION_LEAD_MS && mark.atMs <= frameEnd
    ))
    .map((mark) => ({
      ...mark,
      offsetMs: mark.atMs - entry.startTime,
    }));
  longAnimationFrames.push({
    startTimeMs: entry.startTime,
    durationMs: entry.duration,
    blockingDurationMs: entry.blockingDuration ?? 0,
    forcedStyleAndLayoutMs,
    scripts,
    nearbyEvents,
  });
  if (longAnimationFrames.length > MAX_LONG_ANIMATION_FRAME_SAMPLES) {
    longAnimationFrames.shift();
  }
}

function describeMotionTarget(target: EventTarget | null): {
  label: string;
  vivid: boolean;
} {
  if (!(target instanceof Element)) return { label: "unknown", vivid: false };

  const id = target.id ? `#${target.id}` : "";
  const classes = [...target.classList].slice(0, 4).map((name) => `.${name}`).join("");
  return {
    label: `${target.tagName.toLowerCase()}${id}${classes}`,
    vivid: Boolean(
      target.closest("#VividLyrics-MainPage, #VividLyrics-Card, #VividLyrics-Fullscreen"),
    ),
  };
}

function captureTransitionRun(event: TransitionEvent): void {
  if (!enabled || event.target === document.documentElement) return;
  const target = describeMotionTarget(event.target);
  const sample: CssMotionSample = {
    atMs: performance.now(),
    kind: "transition",
    name: event.propertyName,
    target: target.label,
    vivid: target.vivid,
  };
  cssMotion.push(sample);
  if (cssMotion.length > MAX_CSS_MOTION_SAMPLES) cssMotion.shift();
  markPerformanceEvent(
    `css.transition:${target.vivid ? "vivid" : "spotify"}:${event.propertyName}:${target.label}`,
  );
}

function captureAnimationStart(event: AnimationEvent): void {
  if (!enabled || event.target === document.documentElement) return;
  const target = describeMotionTarget(event.target);
  const sample: CssMotionSample = {
    atMs: performance.now(),
    kind: "animation",
    name: event.animationName,
    target: target.label,
    vivid: target.vivid,
  };
  cssMotion.push(sample);
  if (cssMotion.length > MAX_CSS_MOTION_SAMPLES) cssMotion.shift();
  markPerformanceEvent(
    `css.animation:${target.vivid ? "vivid" : "spotify"}:${event.animationName}:${target.label}`,
  );
}

function bindCssMotionListeners(): void {
  if (cssMotionListenersBound) return;
  document.addEventListener("transitionrun", captureTransitionRun, true);
  document.addEventListener("animationstart", captureAnimationStart, true);
  cssMotionListenersBound = true;
}

function unbindCssMotionListeners(): void {
  if (!cssMotionListenersBound) return;
  document.removeEventListener("transitionrun", captureTransitionRun, true);
  document.removeEventListener("animationstart", captureAnimationStart, true);
  cssMotionListenersBound = false;
}

function startObservers(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordPerformanceDuration("browser.longTask", entry.duration);
        incrementPerformanceCounter("browser.longTasks");
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    longTaskObserver = null;
  }

  const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
  const supportsLongAnimationFrames = supportedTypes.includes("long-animation-frame");
  gauges.set("diagnostics.longAnimationFramesSupported", supportsLongAnimationFrames ? 1 : 0);
  if (!supportsLongAnimationFrames) return;

  try {
    longAnimationFrameObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        captureLongAnimationFrame(entry as LongAnimationFrameEntryLike);
      }
    });
    longAnimationFrameObserver.observe({ type: "long-animation-frame", buffered: false });
  } catch {
    longAnimationFrameObserver = null;
    gauges.set("diagnostics.longAnimationFramesSupported", 0);
  }
}

export function startPerformanceLogging(): void {
  if (enabled) return;
  enabled = true;
  lastFrameAt = 0;
  resetPerformanceData();
  startObservers();
  bindCssMotionListeners();
  reportTimer = setInterval(reportPerformance, REPORT_INTERVAL_MS);
  console.info("[Vivid Lyrics Perf] Diagnostics started. Reports print every 5 seconds.");
}

export function stopPerformanceLogging(): void {
  if (!enabled) return;
  enabled = false;
  if (reportTimer !== null) clearInterval(reportTimer);
  reportTimer = null;
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  longAnimationFrameObserver?.disconnect();
  longAnimationFrameObserver = null;
  unbindCssMotionListeners();
  console.info("[Vivid Lyrics Perf] Diagnostics stopped.");
}

export function isPerformanceLoggingEnabled(): boolean {
  return enabled;
}

export function recordPerformanceFrame(now: number): void {
  if (!enabled) return;
  if (lastFrameAt > 0) {
    frameIntervals.push(now - lastFrameAt);
    if (frameIntervals.length > MAX_FRAME_SAMPLES) frameIntervals.shift();
  }
  lastFrameAt = now;
}

export function recordPerformanceDuration(name: string, durationMs: number): void {
  if (!enabled || !Number.isFinite(durationMs)) return;
  const stat = timings.get(name) ?? { calls: 0, totalMs: 0, maxMs: 0 };
  stat.calls++;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  timings.set(name, stat);
}

export function incrementPerformanceCounter(name: string, amount = 1): void {
  if (!enabled) return;
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function markPerformanceEvent(name: string): void {
  if (!enabled) return;
  const now = performance.now();
  eventMarks.push({ name, atMs: now });
  const cutoff = now - EVENT_MARK_RETENTION_MS;
  while (eventMarks.length && eventMarks[0].atMs < cutoff) eventMarks.shift();
  if (eventMarks.length > MAX_EVENT_MARKS) {
    eventMarks.splice(0, eventMarks.length - MAX_EVENT_MARKS);
  }
}

export function setPerformanceGauge(name: string, value: number): void {
  if (!enabled) return;
  gauges.set(name, value);
}

export function setupPerformanceLogger(): void {
  const api = {
    start: startPerformanceLogging,
    stop: stopPerformanceLogging,
    report: reportPerformance,
    snapshot: getPerformanceSnapshot,
    copy: copyLatestPerformanceReport,
    reset: resetPerformanceData,
  };
  (window as any).VividLyricsPerf = api;
  const vivid = (window as any).__vivid_lyrics;
  if (vivid) vivid.performance = api;

  if (get("performanceLogging")) startPerformanceLogging();
  onSettingsChange(({ key }) => {
    if (key !== "performanceLogging" && key !== null) return;
    if (get("performanceLogging")) startPerformanceLogging();
    else stopPerformanceLogging();
  });
}
