import type { TransformedLyrics } from "./types.ts";
import type { ProviderName } from "./providers/types.ts";

const CACHE_PREFIX = "VividLyrics/lyrics/v6/";
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 20 * 60 * 1000;

type CacheEntry =
  | { kind: "hit"; data: TransformedLyrics; provider?: ProviderName; fetchedAt: number }
  | { kind: "miss"; fetchedAt: number };

export type LyricsCacheLookup = {
  lyrics: TransformedLyrics | null;
  provider?: ProviderName;
};

export type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function finiteTime(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isTransformedLyrics(value: unknown): value is TransformedLyrics {
  if (!value || typeof value !== "object") return false;
  const lyrics = value as Record<string, unknown>;
  if (lyrics.naturalAlignment !== "Left" && lyrics.naturalAlignment !== "Right") return false;
  if (typeof lyrics.language !== "string") return false;
  if (lyrics.type === "Static") return Array.isArray(lyrics.lines);
  if (lyrics.type !== "Line" && lyrics.type !== "Syllable") return false;
  return finiteTime(lyrics.startTime)
    && finiteTime(lyrics.endTime)
    && (lyrics.endTime as number) >= (lyrics.startTime as number)
    && Array.isArray(lyrics.content);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (!finiteTime(entry.fetchedAt)) return false;
  if (entry.kind === "miss") return true;
  const validProvider = entry.provider === undefined
    || entry.provider === "BiniLyrics"
    || entry.provider === "AMLL"
    || entry.provider === "LRCLIB";
  return entry.kind === "hit" && validProvider && isTransformedLyrics(entry.data);
}

export class LyricsCache {
  private readonly memory = new Map<string, CacheEntry>();
  private readonly storage: StorageLike | null;
  private readonly now: () => number;

  constructor(
    storage: StorageLike | null,
    now: () => number = Date.now,
  ) {
    this.storage = storage;
    this.now = now;
  }

  private key(trackId: string): string {
    return CACHE_PREFIX + trackId;
  }

  private expired(entry: CacheEntry): boolean {
    const ttl = entry.kind === "hit" ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    return this.now() - entry.fetchedAt > ttl;
  }

  private remove(trackId: string): void {
    this.memory.delete(trackId);
    try {
      this.storage?.removeItem(this.key(trackId));
    } catch {}
  }

  getWithMetadata(trackId: string): LyricsCacheLookup | undefined {
    const memoryEntry = this.memory.get(trackId);
    if (memoryEntry) {
      if (this.expired(memoryEntry)) {
        this.remove(trackId);
        return undefined;
      }
      return memoryEntry.kind === "hit"
        ? { lyrics: memoryEntry.data, provider: memoryEntry.provider }
        : { lyrics: null };
    }

    try {
      const raw = this.storage?.getItem(this.key(trackId));
      if (!raw) return undefined;
      const entry: unknown = JSON.parse(raw);
      if (!isCacheEntry(entry) || this.expired(entry)) {
        this.remove(trackId);
        return undefined;
      }
      this.memory.set(trackId, entry);
      return entry.kind === "hit"
        ? { lyrics: entry.data, provider: entry.provider }
        : { lyrics: null };
    } catch {
      this.remove(trackId);
      return undefined;
    }
  }

  get(trackId: string): TransformedLyrics | null | undefined {
    return this.getWithMetadata(trackId)?.lyrics;
  }

  setHit(trackId: string, data: TransformedLyrics, provider?: ProviderName): void {
    if (!isTransformedLyrics(data)) return;
    this.store(trackId, { kind: "hit", data, provider, fetchedAt: this.now() });
  }

  setMiss(trackId: string): void {
    this.store(trackId, { kind: "miss", fetchedAt: this.now() });
  }

  private store(trackId: string, entry: CacheEntry): void {
    this.memory.set(trackId, entry);
    try {
      this.storage?.setItem(this.key(trackId), JSON.stringify(entry));
    } catch {}
  }

  clear(): void {
    this.memory.clear();
    if (!this.storage) return;
    try {
      for (let index = this.storage.length - 1; index >= 0; index--) {
        const key = this.storage.key(index);
        if (key?.startsWith(CACHE_PREFIX)) this.storage.removeItem(key);
      }
    } catch {}
  }
}

const cache = new LyricsCache(typeof localStorage === "undefined" ? null : localStorage);

export function getLyricsFromCache(trackId: string): TransformedLyrics | null | undefined {
  return cache.get(trackId);
}

export function getLyricsCacheLookup(trackId: string): LyricsCacheLookup | undefined {
  return cache.getWithMetadata(trackId);
}

export function setLyricsCache(
  trackId: string,
  data: TransformedLyrics,
  provider?: ProviderName,
): void {
  cache.setHit(trackId, data, provider);
}

export function setLyricsCacheNegative(trackId: string): void {
  cache.setMiss(trackId);
}

export function clearLyricsCache(): void {
  cache.clear();
}
