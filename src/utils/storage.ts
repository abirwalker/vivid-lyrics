const PREFIX = "VividLyrics/";

export default {
  get(key: string): string | null {
    try {
      return Spicetify.LocalStorage.get(PREFIX + key);
    } catch {
      return null;
    }
  },

  set(key: string, value: string): void {
    try {
      Spicetify.LocalStorage.set(PREFIX + key, value);
    } catch {
      // storage full or blocked
    }
  },

  remove(key: string): void {
    try {
      Spicetify.LocalStorage.set(PREFIX + key, "");
    } catch {
      // ignore
    }
  },
};
