const props = new WeakMap<Element, Map<string, string>>();

interface NumericStyleState {
  scale: number;
  y: number;
  opacity: number;
}

const numProps = new WeakMap<Element, NumericStyleState>();

// Pre-allocated static strings for glow opacity (0% to 100% in steps of 2)
const OPACITY_STRINGS: string[] = [];
for (let i = 0; i <= 100; i += 2) {
  OPACITY_STRINGS[i] = `${i}%`;
}

// Pre-allocated static strings for glow blur (0px to 60px in steps of 0.5px -> index 0 to 120)
const BLUR_STRINGS: string[] = [];
const FILTER_STRINGS: string[] = [];
for (let i = 0; i <= 120; i++) {
  BLUR_STRINGS[i] = `${i * 0.5}px`;
  FILTER_STRINGS[i] = `${i * 0.25}px`;
}

export function setCachedStyle(el: Element, prop: string, value: string): void {
  let map = props.get(el);
  if (!map) {
    map = new Map();
    props.set(el, map);
  }
  if (map.get(prop) === value) return;
  map.set(prop, value);
  (el as HTMLElement).style.setProperty(prop, value);
}

export function setCachedInline(el: Element, prop: string, value: string): void {
  let map = props.get(el);
  if (!map) {
    map = new Map();
    props.set(el, map);
  }
  if (map.get(prop) === value) return;
  map.set(prop, value);
  const num = numProps.get(el);
  if (num) {
    if (prop === "scale") num.scale = Number.NaN;
    else if (prop === "transform") num.y = Number.NaN;
    else if (prop === "opacity") num.opacity = Number.NaN;
  }
  (el as HTMLElement).style[prop as any] = value;
}

export function setCachedScale(el: Element, scale: number): void {
  let state = numProps.get(el);
  if (!state) {
    state = { scale: Number.NaN, y: Number.NaN, opacity: Number.NaN };
    numProps.set(el, state);
  }
  const rounded = Math.round(scale * 1000) / 1000;
  if (state.scale === rounded) return;
  state.scale = rounded;
  let map = props.get(el);
  if (!map) {
    map = new Map();
    props.set(el, map);
  }
  const value = rounded === 1 ? "1" : `${rounded}`;
  if (map.get("scale") === value) return;
  map.set("scale", value);
  (el as HTMLElement).style.scale = value;
}

export function setCachedTransformY(el: Element, yOffset: number): void {
  let state = numProps.get(el);
  if (!state) {
    state = { scale: Number.NaN, y: Number.NaN, opacity: Number.NaN };
    numProps.set(el, state);
  }
  const rounded = Math.round(yOffset * 10000) / 10000;
  if (state.y === rounded) return;
  state.y = rounded;
  let map = props.get(el);
  if (!map) {
    map = new Map();
    props.set(el, map);
  }
  const value =
    rounded === 0
      ? ""
      : `translate3d(0, calc(var(--vl-default-font-size) * ${rounded}), 0)`;
  if (map.get("transform") === value) return;
  map.set("transform", value);
  (el as HTMLElement).style.transform = value;
}

export function setCachedOpacity(el: Element, opacity: number): void {
  let state = numProps.get(el);
  if (!state) {
    state = { scale: Number.NaN, y: Number.NaN, opacity: Number.NaN };
    numProps.set(el, state);
  }
  const rounded = Math.round(opacity * 100) / 100;
  if (state.opacity === rounded) return;
  state.opacity = rounded;
  let map = props.get(el);
  if (!map) {
    map = new Map();
    props.set(el, map);
  }
  const value = rounded === 1 ? "1" : rounded === 0 ? "0" : `${rounded}`;
  if (map.get("opacity") === value) return;
  map.set("opacity", value);
  (el as HTMLElement).style.opacity = value;
}

/**
 * Update animated glow variables at a precision the soft shadow can visibly
 * represent. Springs still run at the display refresh rate, but tiny sub-pixel
 * changes no longer force Chromium to rerasterize every glowing glyph on every
 * 120/144/180 Hz frame.
 */
export function setCachedGlow(
  el: Element,
  blurRadiusPx: number,
  opacityPercent: number,
): void {
  const opacity = Math.round(Math.max(0, Math.min(opacityPercent, 100)) / 2) * 2;
  const opStr = OPACITY_STRINGS[opacity] ?? `${opacity}%`;
  setCachedStyle(el, "--text-shadow-opacity", opStr);
  if (opacity > 0) {
    const blurIdx = Math.min(120, Math.round(Math.max(0, blurRadiusPx) * 2));
    const blurStr = BLUR_STRINGS[blurIdx] ?? `${blurIdx * 0.5}px`;
    const filterStr = FILTER_STRINGS[blurIdx] ?? `${blurIdx * 0.25}px`;
    setCachedStyle(el, "--text-shadow-blur-radius", blurStr);
    setCachedStyle(el, "--vl-glow-filter-radius", filterStr);
  }
}

export function clearCachedStyle(el: Element, prop: string): void {
  const map = props.get(el);
  if (map) map.delete(prop);
  const num = numProps.get(el);
  if (num) {
    if (prop === "scale") num.scale = Number.NaN;
    else if (prop === "transform") num.y = Number.NaN;
    else if (prop === "opacity") num.opacity = Number.NaN;
  }
}
