/**
 * Spicy Spring Engine
 */

// --- Cubic Spline (from cubic-spline npm) ---
class Spline {
  private xs: number[];
  private ys: number[];
  private ks: Float64Array;

  constructor(xs: number[], ys: number[]) {
    this.xs = xs;
    this.ys = ys;
    this.ks = this.getNaturalKs(new Float64Array(xs.length));
  }

  private getNaturalKs(ks: Float64Array): Float64Array {
    const n = this.xs.length - 1;
    const A = this.zerosMat(n + 1, n + 2);

    for (let i = 1; i < n; i++) {
      A[i][i - 1] = 1 / (this.xs[i] - this.xs[i - 1]);
      A[i][i] =
        2 *
        (1 / (this.xs[i] - this.xs[i - 1]) + 1 / (this.xs[i + 1] - this.xs[i]));
      A[i][i + 1] = 1 / (this.xs[i + 1] - this.xs[i]);
      A[i][n + 1] =
        3 *
        ((this.ys[i] - this.ys[i - 1]) / (this.xs[i] - this.xs[i - 1]) ** 2 +
          (this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]) ** 2);
    }

    A[0][0] = 2 / (this.xs[1] - this.xs[0]);
    A[0][1] = 1 / (this.xs[1] - this.xs[0]);
    A[0][n + 1] =
      (3 * (this.ys[1] - this.ys[0])) / (this.xs[1] - this.xs[0]) ** 2;

    A[n][n - 1] = 1 / (this.xs[n] - this.xs[n - 1]);
    A[n][n] = 2 / (this.xs[n] - this.xs[n - 1]);
    A[n][n + 1] =
      (3 * (this.ys[n] - this.ys[n - 1])) / (this.xs[n] - this.xs[n - 1]) ** 2;

    return this.solve(A, ks);
  }

  private getIndexBefore(target: number): number {
    let low = 0;
    let high = this.xs.length;
    let mid = 0;
    while (low < high) {
      mid = Math.floor((low + high) / 2);
      if (this.xs[mid] < target && mid !== low) {
        low = mid;
      } else if (this.xs[mid] >= target && mid !== high) {
        high = mid;
      } else {
        high = low;
      }
    }
    return low + 1;
  }

  at(x: number): number {
    let i = this.getIndexBefore(x);
    const t = (x - this.xs[i - 1]) / (this.xs[i] - this.xs[i - 1]);
    const a =
      this.ks[i - 1] * (this.xs[i] - this.xs[i - 1]) -
      (this.ys[i] - this.ys[i - 1]);
    const b =
      -this.ks[i] * (this.xs[i] - this.xs[i - 1]) +
      (this.ys[i] - this.ys[i - 1]);
    return (
      (1 - t) * this.ys[i - 1] +
      t * this.ys[i] +
      t * (1 - t) * (a * (1 - t) + b * t)
    );
  }

  private solve(A: Float64Array[], ks: Float64Array): Float64Array {
    const m = A.length;
    let h = 0;
    let k = 0;
    while (h < m && k <= m) {
      let i_max = 0;
      let max = -Infinity;
      for (let i = h; i < m; i++) {
        const v = Math.abs(A[i][k]);
        if (v > max) {
          i_max = i;
          max = v;
        }
      }
      if (A[i_max][k] === 0) {
        k++;
      } else {
        this.swapRows(A, h, i_max);
        for (let i = h + 1; i < m; i++) {
          const f = A[i][k] / A[h][k];
          A[i][k] = 0;
          for (let j = k + 1; j <= m; j++) A[i][j] -= A[h][j] * f;
        }
        h++;
        k++;
      }
    }
    for (let i = m - 1; i >= 0; i--) {
      let v = 0;
      if (A[i][i]) v = A[i][m] / A[i][i];
      ks[i] = v;
      for (let j = i - 1; j >= 0; j--) {
        A[j][m] -= A[j][i] * v;
        A[j][i] = 0;
      }
    }
    return ks;
  }

  private zerosMat(r: number, c: number): Float64Array[] {
    const A: Float64Array[] = [];
    for (let i = 0; i < r; i++) A.push(new Float64Array(c));
    return A;
  }

  private swapRows(m: Float64Array[], k: number, l: number): void {
    const p = m[k];
    m[k] = m[l];
    m[l] = p;
  }
}

function makeSpline(range: { Time: number; Value: number }[]): Spline {
  return new Spline(
    range.map((v) => v.Time),
    range.map((v) => v.Value),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// --- Spring Physics (from @spikerko/web-modules/Spring) ---
const TAU = Math.PI * 2;
const SLEEP_OFFSET_SQ_LIMIT = (1 / 3840) ** 2;
const SLEEP_VELOCITY_SQ_LIMIT = 1e-2 ** 2;
const EPS = 1e-5;

class Spring {
  private DampingRatio: number;
  private Frequency: number;
  private Goal: number;
  private Position: number;
  private Velocity: number;

  constructor(
    startPosition: number,
    frequency: number,
    dampingRatio: number,
    goal = startPosition,
  ) {
    if (frequency * dampingRatio < 0)
      throw new Error("Spring will not converge");
    this.DampingRatio = dampingRatio;
    this.Frequency = frequency;
    this.Goal = goal;
    this.Position = startPosition;
    this.Velocity = 0;
  }

  Step(dt: number): number {
    const d = this.DampingRatio;
    const f = this.Frequency * TAU;
    const goal = this.Goal;
    const pos = this.Position;
    const vel = this.Velocity;

    if (d === 1) {
      const q = Math.exp(-f * dt);
      const w = dt * q;
      const goalDist = pos - goal;
      this.Position = goalDist * (q + w * f) + vel * w + goal;
      this.Velocity = vel * (q - w * f) - goalDist * (w * f * f);
    } else if (d < 1) {
      const fdt = f * dt;
      const q = Math.exp(-d * fdt);
      const c = Math.sqrt(1 - d * d);
      const cfdt = c * fdt;
      const i = Math.cos(cfdt);
      const j = Math.sin(cfdt);

      let z: number;
      if (c > EPS) {
        z = j / c;
      } else {
        const cs = c * c;
        z = fdt + (((fdt * fdt * cs * cs) / 20 - cs) * fdt ** 3) / 6;
      }

      let y: number;
      const fc = f * c;
      if (fc > EPS) {
        y = j / fc;
      } else {
        const fcs = fc * fc;
        y = dt + (((dt * dt * fcs * fcs) / 20 - fcs) * dt ** 3) / 6;
      }

      const goalDist = pos - goal;
      this.Position = (goalDist * (i + z * d) + vel * y) * q + goal;
      this.Velocity = (vel * (i - z * d) - goalDist * (z * f)) * q;
    } else {
      const c = Math.sqrt(d * d - 1);
      const r1 = -f * (d - c);
      const r2 = -f * (d + c);
      const ec1 = Math.exp(r1 * dt);
      const ec2 = Math.exp(r2 * dt);
      const goalDist = pos - goal;
      const co2 = (vel - goalDist * r1) / (2 * f * c);
      const co1 = ec1 * (goalDist - co2);
      const co2ec2 = co2 * ec2;
      this.Position = co1 + co2ec2 + goal;
      this.Velocity = co1 * r1 + co2ec2 * r2;
    }

    return this.Position;
  }

  CanSleep(): boolean {
    return (
      this.Velocity ** 2 <= SLEEP_VELOCITY_SQ_LIMIT &&
      (this.Goal - this.Position) ** 2 <= SLEEP_OFFSET_SQ_LIMIT
    );
  }

  SetGoal(goal: number, replacePosition?: boolean): void {
    this.Goal = goal;
    if (replacePosition) {
      this.Position = goal;
      this.Velocity = 0;
    }
  }
}

// Scale: 0.95 → 1.025 (at 70%) → 1.0 (matches Spicy Lyrics base spline)
// Emphasis multiplier (1.103) is applied in the renderer for letter-level stretch
const ScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.025 },
  { Time: 1, Value: 1 },
];

// YOffset: 0.01 → -0.0167 (at 90%) → 0
const YOffsetRange = [
  { Time: 0, Value: 1 / 100 },
  { Time: 0.9, Value: -(1 / 60) },
  { Time: 1, Value: 0 },
];

// Glow: 0 → 1 (at 15%) → 1 (at 60%) → 0 (matches Spicy Lyrics exactly)
const GlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.15, Value: 1 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 0 },
];

const ScaleSpline = makeSpline(ScaleRange);
const YOffsetSpline = makeSpline(YOffsetRange);
const GlowSpline = makeSpline(GlowRange);

// Spring damping/frequency
const SCALE_DAMPING = 0.6;
const SCALE_FREQUENCY = 0.7;
const YOFFSET_DAMPING = 0.4;
const YOFFSET_FREQUENCY = 1.25;
const GLOW_DAMPING = 0.5;
const GLOW_FREQUENCY = 1;

// --- Public Types ---
export type SpicySpringConfig = {
  enabled: boolean;
};

export type SpringSet = {
  Scale: Spring;
  YOffset: Spring;
  Glow: Spring;
};

// --- Public API ---

export function createSpringSet(): SpringSet {
  return {
    Scale: new Spring(ScaleSpline.at(0), SCALE_FREQUENCY, SCALE_DAMPING),
    YOffset: new Spring(YOffsetSpline.at(0), YOFFSET_FREQUENCY, YOFFSET_DAMPING),
    Glow: new Spring(GlowSpline.at(0), GLOW_FREQUENCY, GLOW_DAMPING),
  };
}

export function setSpringGoals(
  springs: SpringSet,
  timeScale: number,
  state: "NotSung" | "Active" | "Sung",
): void {
  if (state === "Active") {
    springs.Scale.SetGoal(ScaleSpline.at(timeScale));
    springs.YOffset.SetGoal(YOffsetSpline.at(timeScale));
    springs.Glow.SetGoal(GlowSpline.at(timeScale));
  } else if (state === "NotSung") {
    springs.Scale.SetGoal(ScaleSpline.at(0));
    springs.YOffset.SetGoal(YOffsetSpline.at(0));
    springs.Glow.SetGoal(GlowSpline.at(0));
  } else {
    springs.Scale.SetGoal(ScaleSpline.at(1));
    springs.YOffset.SetGoal(YOffsetSpline.at(1));
    springs.Glow.SetGoal(GlowSpline.at(1));
  }
}

export function stepSprings(
  springs: SpringSet,
  deltaTime: number,
): {
  scale: number;
  yOffset: number;
  glow: number;
} {
  return {
    scale: springs.Scale.Step(deltaTime),
    yOffset: springs.YOffset.Step(deltaTime),
    glow: springs.Glow.Step(deltaTime),
  };
}

export function applySpringStyles(
  el: HTMLElement,
  values: { scale: number; yOffset: number; glow: number },
): void {
  el.style.scale = `${values.scale}`;
  el.style.transform = `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset}), 0)`;
  el.style.setProperty("--text-shadow-blur-radius", `${4 + 2 * values.glow}px`);
  el.style.setProperty("--text-shadow-opacity", `${Math.min(values.glow * 35, 100)}%`);
}

export function applyGlowStyles(
  el: HTMLElement,
  glowAlpha: number,
  intensity: number,
  blurBase = 4,
): void {
  const a = glowAlpha * intensity;
  const blur = blurBase + 8 * a;
  el.style.setProperty("--text-shadow-blur-radius", `${blur}px`);
  el.style.setProperty("--text-shadow-opacity", `${a}`);
}

export function isEmphasized(duration: number, textLength: number): boolean {
  return duration >= 1 && textLength <= 12;
}

// easeSinOut from d3-ease (portable)
export function easeSinOut(t: number): number {
  return 1 - Math.cos((t * Math.PI) / 2);
}

// Re-export spline for external use
export { makeSpline, clamp, ScaleSpline, YOffsetSpline, GlowSpline };
export type { Spline };
