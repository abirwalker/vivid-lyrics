type Callback = (...args: any[]) => void;
type ListenerId = number;

const registry = new Map<string, Map<ListenerId, Callback>>();
let nextId = 1;

export function on(name: string, cb: Callback): ListenerId {
  if (!registry.has(name)) {
    registry.set(name, new Map());
  }
  const id = nextId++;
  registry.get(name)!.set(id, cb);
  return id;
}

export function off(id: ListenerId): boolean {
  for (const listeners of registry.values()) {
    if (listeners.has(id)) {
      listeners.delete(id);
      if (listeners.size === 0) {
        registry.delete(key(registry, id));
      }
      return true;
    }
  }
  return false;
}

export function emit(name: string, ...args: any[]): void {
  const listeners = registry.get(name);
  if (listeners) {
    for (const cb of listeners.values()) {
      cb(...args);
    }
  }
}

function key(map: Map<string, Map<ListenerId, Callback>>, id: ListenerId): string {
  for (const [k, v] of map) {
    if (v.has(id)) return k;
  }
  return "";
}
