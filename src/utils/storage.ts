const PREFIX = "VividLyrics/";

export default {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // storage full or blocked
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
  },
};
