import { isJapanese, isRomaji } from "wanakana";
import { parseTtml } from "../parsers/ttml.ts";
import { cleanIsrc, cleanTitleForSearch, normalizeMatchText, scoreCandidate } from "./matching.ts";
import { fetchWithDeadline, isTransientStatus, RequestFailure } from "./request.ts";
import type { MatchCandidate } from "./matching.ts";
import type { Provider, ProviderResult, TrackQuery } from "./types.ts";

const API = "https://lyrics-api.binimum.org";

type BiniItem = {
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  duration?: number;
  isrc?: string;
  lyricsUrl?: string;
};

function itemsFromBody(body: unknown): BiniItem[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const results = (body as Record<string, unknown>).results;
  return Array.isArray(results) ? results : [];
}

function matchCandidate(item: BiniItem): MatchCandidate {
  return {
    titles: item.track_name ? [item.track_name] : [],
    artists: item.artist_name ? [item.artist_name] : [],
    albums: item.album_name ? [item.album_name] : [],
    durationMs: typeof item.duration === "number" ? item.duration * 1000 : undefined,
    isrcs: item.isrc ? [item.isrc] : [],
  };
}

function searchQueries(query: TrackQuery): string[] {
  const title = query.title.trim();
  const cleanedTitle = cleanTitleForSearch(title);
  const primaryArtist = query.artists[0] ?? "";
  const allArtists = query.artists.join(" ");
  return [...new Set([
    `${cleanedTitle} ${primaryArtist}`,
    `${cleanedTitle} ${allArtists}`,
    `${title} ${primaryArtist}`,
    cleanedTitle,
  ].map((value) => value.trim()).filter(Boolean))];
}

function latinKey(value: string): string {
  return normalizeMatchText(value).replace(/[^a-z0-9]/g, "");
}

function artistKey(value: string): string {
  return normalizeMatchText(value).split(" ").filter(Boolean).sort().join(" ");
}

function romanizedCandidateScore(query: TrackQuery, reading: string, item: BiniItem): number | null {
  if (!query.durationMs || !item.duration || !item.track_name || !item.artist_name) return null;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading)) return null;
  const title = latinKey(reading);
  const artist = artistKey(query.artists[0]);
  if (!title || title !== latinKey(item.track_name)) return null;
  if (!artist || artist !== artistKey(item.artist_name)) return null;
  const difference = Math.abs(query.durationMs - item.duration * 1000);
  return difference <= 2000 ? 100 - difference / 1000 : null;
}

async function requestItems(url: string, signal: AbortSignal): Promise<{
  items: BiniItem[];
  transient: boolean;
}> {
  try {
    const response = await fetchWithDeadline(url, { signal });
    if (isTransientStatus(response.status)) return { items: [], transient: true };
    if (!response.ok) return { items: [], transient: false };
    return { items: itemsFromBody(await response.json()), transient: false };
  } catch (error) {
    if (error instanceof RequestFailure && error.kind === "aborted") throw error;
    return { items: [], transient: true };
  }
}

async function fetchCandidateLyrics(
  query: TrackQuery,
  items: BiniItem[],
  signal: AbortSignal,
  score: (item: BiniItem) => number | null = (item) => scoreCandidate(query, matchCandidate(item)),
): Promise<{ result: Extract<ProviderResult, { status: "lyrics" }> | null; transient: boolean }> {
  const candidates = new Map<string, BiniItem>();
  for (const item of items) {
    candidates.set(`${item.isrc ?? ""}|${item.lyricsUrl ?? ""}`, item);
  }

  const ranked = [...candidates.values()]
    .map((item) => ({ item, score: score(item) }))
    .filter((entry): entry is { item: BiniItem; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  let staticLyrics: Extract<ProviderResult, { status: "lyrics" }> | null = null;
  let transient = false;

  for (const { item } of ranked) {
    if (!item.lyricsUrl) continue;
    let url: URL;
    try {
      url = new URL(item.lyricsUrl);
      if (url.protocol !== "https:") continue;
    } catch {
      continue;
    }

    try {
      const response = await fetchWithDeadline(url.href, { signal });
      if (isTransientStatus(response.status)) {
        transient = true;
        continue;
      }
      if (!response.ok) continue;
      const lyrics = parseTtml(await response.text());
      if (!lyrics) {
        transient = true;
        continue;
      }
      if (lyrics.type !== "Static") {
        return { result: { status: "lyrics", provider: "BiniLyrics", lyrics }, transient };
      }
      staticLyrics ??= { status: "lyrics", provider: "BiniLyrics", lyrics };
    } catch (error) {
      if (error instanceof RequestFailure && error.kind === "aborted") throw error;
      transient = true;
    }
  }

  return { result: staticLyrics, transient };
}

export async function lookupBini(
  query: TrackQuery,
  signal: AbortSignal,
  readJapaneseTitle?: (title: string) => Promise<string>,
): Promise<ProviderResult> {
  let sawTransientFailure = false;
  const isrc = cleanIsrc(query.isrc);

  if (isrc) {
    const exact = await requestItems(`${API}/getLyrics?isrc=${encodeURIComponent(isrc)}`, signal);
    sawTransientFailure ||= exact.transient;
    const fetched = await fetchCandidateLyrics(query, exact.items, signal);
    sawTransientFailure ||= fetched.transient;
    if (fetched.result) return fetched.result;
  }

  const searchItems: BiniItem[] = [];
  for (const search of searchQueries(query)) {
    const result = await requestItems(`${API}/getLyrics?q=${encodeURIComponent(search)}`, signal);
    sawTransientFailure ||= result.transient;
    searchItems.push(...result.items);
  }

  const searched = await fetchCandidateLyrics(query, searchItems, signal);
  sawTransientFailure ||= searched.transient;
  if (searched.result) return searched.result;

  if (!isrc && query.durationMs && query.artists.length === 1
    && isJapanese(query.title) && isRomaji(query.artists[0])) {
    const artistSearch = await requestItems(
      `${API}/getLyrics?q=${encodeURIComponent(query.artists[0])}`,
      signal,
    );
    sawTransientFailure ||= artistSearch.transient;
    if (artistSearch.items.length) {
      const romanize = readJapaneseTitle ?? (await import("../romanize/romanize.ts")).romanizeJP;
      const reading = await romanize(query.title);
      const romanized = await fetchCandidateLyrics(
        query,
        artistSearch.items,
        signal,
        (item) => romanizedCandidateScore(query, reading, item),
      );
      sawTransientFailure ||= romanized.transient;
      if (romanized.result) return romanized.result;
    }
  }

  return sawTransientFailure
    ? { status: "transient", provider: "BiniLyrics", reason: "request-or-parse-failure" }
    : { status: "miss", provider: "BiniLyrics" };
}

export const biniProvider: Provider = { name: "BiniLyrics", lookup: lookupBini };
