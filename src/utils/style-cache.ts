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

export function clearCachedStyle(el: Element, prop: string): void {
  const map = props.get(el);
  if (map) map.delete(prop);
}
