const CACHE_PREFIX = "VividLyrics/lyrics/";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEntry = {
  data: any;
  fetchedAt: number;
};

const memoryCache = new Map<string, CacheEntry>();

function storageGet(trackId: string): CacheEntry | null {
  try {
    const key = CACHE_PREFIX + trackId;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.fetchedAt > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function storageSet(trackId: string, entry: CacheEntry): void {
  try {
    const key = CACHE_PREFIX + trackId;
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {}
}

export function getLyricsFromCache(trackId: string): any | undefined {
  const mem = memoryCache.get(trackId);
  if (mem) return mem.data;

  const stored = storageGet(trackId);
  if (stored) {
    memoryCache.set(trackId, stored);
    return stored.data;
  }

  return undefined;
}

export function setLyricsCache(trackId: string, data: any): void {
  const entry: CacheEntry = { data, fetchedAt: Date.now() };
  memoryCache.set(trackId, entry);
  storageSet(trackId, entry);
}

export function setLyricsCacheNegative(trackId: string): void {
  const entry: CacheEntry = { data: null, fetchedAt: Date.now() };
  memoryCache.set(trackId, entry);
  storageSet(trackId, entry);
}

export function clearLyricsCache(): void {
  memoryCache.clear();
}
