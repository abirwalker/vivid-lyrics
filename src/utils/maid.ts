import { uid } from "./uid";
import { isScheduled, cancel, type Scheduled } from "./scheduler";

type Cleanable =
  | { destroy(): void }
  | Scheduled
  | MutationObserver
  | ResizeObserver
  | Element
  | (() => void);

function cleanItem(item: Cleanable): void {
  if (typeof item === "function") {
    item();
  } else if (isScheduled(item)) {
    cancel(item);
  } else if (item instanceof MutationObserver || item instanceof ResizeObserver) {
    item.disconnect();
  } else if (item instanceof Element) {
    item.remove();
  } else if ("destroy" in item && typeof item.destroy === "function") {
    item.destroy();
  }
}

export class Maid {
  private items = new Map<string, Cleanable>();
  private destroyed = false;

  give<T extends Cleanable>(item: T, key?: string): T {
    if (this.destroyed) {
      cleanItem(item);
      return item;
    }
    const k = key ?? uid();
    if (this.items.has(k)) this.clean(k);
    this.items.set(k, item);
    return item;
  }

  giveFn(fn: () => void): string {
    const key = uid();
    if (this.destroyed) {
      fn();
      return key;
    }
    this.items.set(key, fn);
    return key;
  }

  get<T extends Cleanable>(key: string): T | undefined {
    return this.destroyed ? undefined : (this.items.get(key) as T);
  }

  has(key: string): boolean {
    return !this.destroyed && this.items.has(key);
  }

  clean(key: string): void {
    if (this.destroyed) return;
    const item = this.items.get(key);
    if (item !== undefined) {
      this.items.delete(key);
      cleanItem(item);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const [key] of this.items) {
      this.clean(key);
    }
    this.destroyed = true;
  }
}
