import { parseTtml } from "../parsers/ttml.ts";
import { scoreCandidate } from "./matching.ts";
import { fetchWithDeadline, isTransientStatus, RequestFailure } from "./request.ts";
import type { MatchCandidate } from "./matching.ts";
import type { Provider, ProviderResult, TrackQuery } from "./types.ts";

const API = "https://api.amll.dev/v1/lyrics";

type AmllItem = {
  id?: number | string;
  filename?: string;
  musicNames?: string[];
  artistNames?: string[];
  albumNames?: string[];
  spotifyIds?: string[];
  isrcs?: string[];
  lyrics?: string;
};

function candidate(item: AmllItem): MatchCandidate {
  return {
    titles: item.musicNames ?? [],
    artists: item.artistNames ?? [],
    albums: item.albumNames ?? [],
    spotifyIds: item.spotifyIds ?? [],
    isrcs: item.isrcs ?? [],
  };
}

async function fetchItem(params: URLSearchParams, signal: AbortSignal): Promise<{
  item: AmllItem | null;
  transient: boolean;
}> {
  try {
    const response = await fetchWithDeadline(`${API}/get?${params}`, { signal });
    if (isTransientStatus(response.status)) return { item: null, transient: true };
    if (!response.ok) return { item: null, transient: false };
    const body = await response.json();
    const item = body?.data;
    return { item: item && typeof item === "object" ? item : null, transient: false };
  } catch (error) {
    if (error instanceof RequestFailure && error.kind === "aborted") throw error;
    return { item: null, transient: true };
  }
}

async function lookupAmll(query: TrackQuery, signal: AbortSignal): Promise<ProviderResult> {
  let sawTransientFailure = false;
  let staticLyrics: Extract<ProviderResult, { status: "lyrics" }> | null = null;

  const accept = (item: AmllItem | null): ProviderResult | null => {
    if (!item || typeof item.lyrics !== "string") return null;
    const lyrics = parseTtml(item.lyrics, undefined, "amll");
    if (!lyrics) {
      sawTransientFailure = true;
      return null;
    }
    const result = { status: "lyrics" as const, provider: "AMLL" as const, lyrics };
    if (lyrics.type === "Static") {
      staticLyrics ??= result;
      return null;
    }
    return result;
  };

  for (const [key, value] of [["spotifyId", query.spotifyId], ["isrc", query.isrc]] as const) {
    if (!value) continue;
    const params = new URLSearchParams();
    params.append(key, value);
    const result = await fetchItem(params, signal);
    sawTransientFailure ||= result.transient;
    const accepted = accept(result.item);
    if (accepted) return accepted;
  }

  try {
    const params = new URLSearchParams({
      musicName: query.title,
      artistName: query.artists[0],
      pageSize: "8",
    });
    if (query.album) params.set("albumName", query.album);
    const response = await fetchWithDeadline(`${API}/search?${params}`, { signal });
    if (isTransientStatus(response.status)) {
      sawTransientFailure = true;
    } else if (response.ok) {
      const body = await response.json();
      const items: AmllItem[] = Array.isArray(body?.data?.items) ? body.data.items : [];
      const ranked = items
        .map((item) => ({ item, score: scoreCandidate(query, candidate(item)) }))
        .filter((entry): entry is { item: AmllItem; score: number } => entry.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      for (const { item } of ranked) {
        const itemParams = new URLSearchParams();
        if (item.id !== undefined) itemParams.set("id", String(item.id));
        else if (item.filename) itemParams.set("filename", item.filename);
        else continue;
        const full = await fetchItem(itemParams, signal);
        sawTransientFailure ||= full.transient;
        const accepted = accept(full.item);
        if (accepted) return accepted;
      }
    }
  } catch (error) {
    if (error instanceof RequestFailure && error.kind === "aborted") throw error;
    sawTransientFailure = true;
  }

  if (staticLyrics) return staticLyrics;
  return sawTransientFailure
    ? { status: "transient", provider: "AMLL", reason: "request-or-parse-failure" }
    : { status: "miss", provider: "AMLL" };
}

export const amllProvider: Provider = { name: "AMLL", lookup: lookupAmll };
