import { isJapanese, isRomaji } from "wanakana";
import { parseLrc, parsePlainLyrics } from "../parsers/lrc.ts";
import { scoreCandidate } from "./matching.ts";
import {
  fetchWithDeadline,
  isTransientStatus,
  RequestFailure,
  retryAfterMs,
  waitForDelay,
} from "./request.ts";
import type { MatchCandidate } from "./matching.ts";
import type { Provider, ProviderResult, TrackQuery } from "./types.ts";

const API = "https://lrclib.net/api";
const HEADERS = {
  "Lrclib-Client": "VividLyrics/0.2.5 (https://github.com/abirwalker/vivid-lyrics)",
};

type LrclibItem = {
  trackName?: string;
  name?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string;
  plainLyrics?: string;
};

function candidate(item: LrclibItem): MatchCandidate {
  return {
    titles: [item.trackName ?? item.name ?? ""].filter(Boolean),
    artists: [item.artistName ?? ""].filter(Boolean),
    albums: [item.albumName ?? ""].filter(Boolean),
    durationMs: typeof item.duration === "number" ? item.duration * 1000 : undefined,
  };
}

async function request(url: string, signal: AbortSignal): Promise<Response> {
  let response = await fetchWithDeadline(url, { signal, headers: HEADERS });
  if (response.status !== 429) return response;
  const delay = retryAfterMs(response);
  if (delay === null || delay > 3000) return response;
  await waitForDelay(delay, signal);
  response = await fetchWithDeadline(url, { signal, headers: HEADERS });
  return response;
}

function lyricsFromItem(item: LrclibItem, query: TrackQuery) {
  if (item.syncedLyrics?.trim()) {
    return parseLrc(item.syncedLyrics, { durationMs: query.durationMs });
  }
  if (item.plainLyrics?.trim()) return parsePlainLyrics(item.plainLyrics);
  return null;
}

async function lookupLrclib(query: TrackQuery, signal: AbortSignal): Promise<ProviderResult> {
  let sawTransientFailure = false;
  let instrumental = false;
  let staticLyrics: Extract<ProviderResult, { status: "lyrics" }> | null = null;
  const exactParams = new URLSearchParams({
    track_name: query.title,
    artist_name: query.artists[0],
  });
  if (query.album) exactParams.set("album_name", query.album);
  if (query.durationMs) exactParams.set("duration", String(Math.round(query.durationMs / 1000)));

  try {
    const response = await request(`${API}/get?${exactParams}`, signal);
    if (isTransientStatus(response.status)) {
      sawTransientFailure = true;
    } else if (response.ok) {
      const item: LrclibItem = await response.json();
      instrumental ||= item.instrumental === true;
      const lyrics = lyricsFromItem(item, query);
      if (lyrics?.type !== "Static" && lyrics) return { status: "lyrics", provider: "LRCLIB", lyrics };
      if (lyrics) staticLyrics = { status: "lyrics", provider: "LRCLIB", lyrics };
    }
  } catch (error) {
    if (error instanceof RequestFailure && error.kind === "aborted") throw error;
    sawTransientFailure = true;
  }

  const search = async (params: URLSearchParams): Promise<ProviderResult | null> => {
    try {
      const response = await request(`${API}/search?${params}`, signal);
      if (isTransientStatus(response.status)) {
        sawTransientFailure = true;
      } else if (response.ok) {
        const items: LrclibItem[] = await response.json();
        const ranked = (Array.isArray(items) ? items : [])
          .map((item) => ({ item, score: scoreCandidate(query, candidate(item)) }))
          .filter((entry): entry is { item: LrclibItem; score: number } => entry.score !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        for (const { item } of ranked) {
          instrumental ||= item.instrumental === true;
          if (item.instrumental) continue;
          const lyrics = lyricsFromItem(item, query);
          if (lyrics?.type !== "Static" && lyrics) return { status: "lyrics", provider: "LRCLIB", lyrics };
          if (lyrics && !staticLyrics) staticLyrics = { status: "lyrics", provider: "LRCLIB", lyrics };
        }
      }
    } catch (error) {
      if (error instanceof RequestFailure && error.kind === "aborted") throw error;
      sawTransientFailure = true;
    }
    return null;
  };

  const searchParams = new URLSearchParams({ track_name: query.title, artist_name: query.artists[0] });
  if (query.album) searchParams.set("album_name", query.album);
  const primary = await search(searchParams);
  if (primary) return primary;

  if (query.durationMs && isJapanese(query.title) && isRomaji(query.artists[0])) {
    const broader = await search(new URLSearchParams({ track_name: query.title }));
    if (broader) return broader;
  }

  if (staticLyrics) return staticLyrics;
  if (sawTransientFailure) {
    return { status: "transient", provider: "LRCLIB", reason: "request-or-parse-failure" };
  }
  return { status: "miss", provider: "LRCLIB", instrumental };
}

export const lrclibProvider: Provider = { name: "LRCLIB", lookup: lookupLrclib };
