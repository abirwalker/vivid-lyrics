import { uid } from "./uid";

export class FreeArray<T> {
  private items = new Map<string, T>();
  private destroyed = false;

  push(item: T): string {
    const key = uid();
    this.items.set(key, item);
    return key;
  }

  get(key: string): T | undefined {
    return this.destroyed ? undefined : this.items.get(key);
  }

  remove(key: string): T | undefined {
    const item = this.items.get(key);
    if (item !== undefined) {
      this.items.delete(key);
      return item;
    }
  }

  entries() {
    return this.items.entries();
  }

  destroy() {
    this.destroyed = true;
  }
}
