const generated = new Set<string>();

export function uid(): string {
  while (true) {
    const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    if (!generated.has(id)) {
      generated.add(id);
      return id;
    }
  }
}
