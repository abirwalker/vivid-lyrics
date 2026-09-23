import { isJapanese, isRomaji } from "wanakana";
import { parseTtml } from "../parsers/ttml.ts";
import { cleanTitleForSearch, normalizeMatchText, scoreCandidate } from "./matching.ts";
import { fetchWithDeadline, isTransientStatus, RequestFailure } from "./request.ts";
import type { MatchCandidate } from "./matching.ts";
import type { Provider, ProviderResult, TrackQuery } from "./types.ts";

const API = "https://lyrics-api.binimum.org";

type BiniItem = {
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  duration?: number;
  lyricsUrl?: string;
};

type BiniDiagnostics = {
  catalogItems: number;
  matchedItems: number;
  missingOrInvalidUrls: number;
  lyricHttp404: number;
  lyricOtherHttp: number;
  parseRejected: number;
  lyricRequestFailures: number;
};

function missReason(diagnostics: BiniDiagnostics, transient: boolean): string {
  if (diagnostics.lyricHttp404) return "matching-lyrics-url-404";
  if (diagnostics.parseRejected) return "matching-lyrics-parse-rejected";
  if (diagnostics.lyricOtherHttp || diagnostics.lyricRequestFailures || transient) return "request-failure";
  if (diagnostics.matchedItems) return "matching-candidate-unusable";
  if (diagnostics.catalogItems) return "catalog-candidates-rejected";
  return "no-catalog-candidate";
}

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
  diagnostics: BiniDiagnostics,
  score: (item: BiniItem) => number | null = (item) => scoreCandidate(query, matchCandidate(item)),
): Promise<{ result: Extract<ProviderResult, { status: "lyrics" }> | null; transient: boolean }> {
  const candidates = new Map<string, BiniItem>();
  for (const item of items) {
    const key = JSON.stringify([
      item.track_name,
      item.artist_name,
      item.album_name,
      item.duration,
      item.lyricsUrl,
    ]);
    candidates.set(key, item);
  }

  const ranked = [...candidates.values()]
    .map((item) => ({ item, score: score(item) }))
    .filter((entry): entry is { item: BiniItem; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  diagnostics.matchedItems += ranked.length;
  let staticLyrics: Extract<ProviderResult, { status: "lyrics" }> | null = null;
  let transient = false;

  for (const { item } of ranked) {
    if (!item.lyricsUrl) {
      diagnostics.missingOrInvalidUrls++;
      continue;
    }
    let url: URL;
    try {
      url = new URL(item.lyricsUrl);
      if (url.protocol !== "https:") {
        diagnostics.missingOrInvalidUrls++;
        continue;
      }
    } catch {
      diagnostics.missingOrInvalidUrls++;
      continue;
    }

    try {
      const response = await fetchWithDeadline(url.href, { signal });
      if (isTransientStatus(response.status)) {
        transient = true;
        diagnostics.lyricOtherHttp++;
        continue;
      }
      if (!response.ok) {
        if (response.status === 404) {
          diagnostics.lyricHttp404++;
        } else {
          diagnostics.lyricOtherHttp++;
        }
        continue;
      }
      const lyrics = parseTtml(await response.text());
      if (!lyrics) {
        transient = true;
        diagnostics.parseRejected++;
        continue;
      }
      if (lyrics.type !== "Static") {
        return { result: { status: "lyrics", provider: "BiniLyrics", lyrics }, transient };
      }
      staticLyrics ??= { status: "lyrics", provider: "BiniLyrics", lyrics };
    } catch (error) {
      if (error instanceof RequestFailure && error.kind === "aborted") throw error;
      transient = true;
      diagnostics.lyricRequestFailures++;
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
  const diagnostics: BiniDiagnostics = {
    catalogItems: 0,
    matchedItems: 0,
    missingOrInvalidUrls: 0,
    lyricHttp404: 0,
    lyricOtherHttp: 0,
    parseRejected: 0,
    lyricRequestFailures: 0,
  };

  const searchItems: BiniItem[] = [];
  for (const search of searchQueries(query)) {
    const result = await requestItems(`${API}/getLyrics?q=${encodeURIComponent(search)}`, signal);
    sawTransientFailure ||= result.transient;
    diagnostics.catalogItems += result.items.length;
    searchItems.push(...result.items);
  }

  const searched = await fetchCandidateLyrics(query, searchItems, signal, diagnostics);
  sawTransientFailure ||= searched.transient;
  if (searched.result) return searched.result;

  if (query.durationMs && query.artists.length === 1
    && isJapanese(query.title) && isRomaji(query.artists[0])) {
    const artistSearch = await requestItems(
      `${API}/getLyrics?q=${encodeURIComponent(query.artists[0])}`,
      signal,
    );
    sawTransientFailure ||= artistSearch.transient;
    diagnostics.catalogItems += artistSearch.items.length;
    if (artistSearch.items.length) {
      const romanize = readJapaneseTitle ?? (await import("../romanize/romanize.ts")).romanizeJP;
      const reading = await romanize(query.title);
      const romanized = await fetchCandidateLyrics(
        query,
        artistSearch.items,
        signal,
        diagnostics,
        (item) => romanizedCandidateScore(query, reading, item),
      );
      sawTransientFailure ||= romanized.transient;
      if (romanized.result) return romanized.result;
    }
  }

  console.info("[VividLyrics] Bini lookup diagnostic", {
    spotifyId: query.spotifyId,
    reason: missReason(diagnostics, sawTransientFailure),
    catalogResults: diagnostics.catalogItems,
    matchedCandidates: diagnostics.matchedItems,
    missingOrInvalidUrls: diagnostics.missingOrInvalidUrls,
    lyricHttp404: diagnostics.lyricHttp404,
    lyricOtherHttp: diagnostics.lyricOtherHttp,
    parseRejected: diagnostics.parseRejected,
    lyricRequestFailures: diagnostics.lyricRequestFailures,
    transientFailure: sawTransientFailure,
  });

  return sawTransientFailure
    ? { status: "transient", provider: "BiniLyrics", reason: "request-or-parse-failure" }
    : { status: "miss", provider: "BiniLyrics" };
}

export const biniProvider: Provider = { name: "BiniLyrics", lookup: lookupBini };
