const props = new WeakMap<Element, Map<string, string>>();

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
  (el as HTMLElement).style[prop as any] = value;
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
  setCachedStyle(el, "--text-shadow-opacity", `${opacity}%`);
  if (opacity > 0) {
    const blur = Math.round(Math.max(0, blurRadiusPx) * 2) / 2;
    setCachedStyle(el, "--text-shadow-blur-radius", `${blur}px`);
    setCachedStyle(el, "--vl-glow-filter-radius", `${blur / 2}px`);
  }
}

export function clearCachedStyle(el: Element, prop: string): void {
  const map = props.get(el);
  if (map) map.delete(prop);
}
