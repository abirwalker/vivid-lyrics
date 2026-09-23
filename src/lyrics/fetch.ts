import type { TransformedLyrics } from "./types.ts";
import { getLyricsCacheLookup, setLyricsCache, setLyricsCacheNegative } from "./cache.ts";
import { fetchFromProviders } from "./providers/index.ts";
import { RequestFailure } from "./providers/request.ts";
import { buildTrackQuery, getSpotifyTrackId } from "./track-query.ts";

const CHAIN_TIMEOUT_MS = 18000;

export async function fetchLyrics(
  uri: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<TransformedLyrics | null> {
  const trackId = getSpotifyTrackId(uri);
  if (!trackId) return null;
  const cached = getLyricsCacheLookup(trackId);
  if (cached !== undefined) {
    console.info("[VividLyrics] lyrics cache hit", {
      spotifyId: trackId,
      provider: cached.provider ?? "unknown",
      lyricType: cached.lyrics?.type ?? "miss",
    });
    return cached.lyrics;
  }
  if (signal.aborted) throw new RequestFailure("aborted", "Lyrics lookup aborted");

  const chainController = new AbortController();
  let chainTimedOut = false;
  const abortChain = () => chainController.abort(signal.reason);
  signal.addEventListener("abort", abortChain, { once: true });
  const timeout = setTimeout(() => {
    chainTimedOut = true;
    chainController.abort();
  }, CHAIN_TIMEOUT_MS);

  try {
    const query = buildTrackQuery(uri);
    if (!query) return null;
    console.info("[VividLyrics] lyrics search", {
      spotifyId: query.spotifyId,
      title: query.title,
      artists: query.artists,
      album: query.album ?? null,
      durationMs: query.durationMs ?? null,
    });
    const result = await fetchFromProviders(query, chainController.signal);
    if (result.lyrics) {
      console.info("[VividLyrics] lyrics selected", {
        provider: result.provider,
        lyricType: result.lyrics.type,
        title: query.title,
        artists: query.artists,
        album: query.album ?? null,
      });
      setLyricsCache(trackId, result.lyrics, result.provider ?? undefined);
      return result.lyrics;
    }
    console.info("[VividLyrics] lyrics unavailable", {
      title: query.title,
      artists: query.artists,
      album: query.album ?? null,
      definitiveMiss: result.definitiveMiss,
      instrumental: result.instrumental,
    });
    if (result.definitiveMiss) setLyricsCacheNegative(trackId);
    return null;
  } catch (error) {
    if (signal.aborted) throw new RequestFailure("aborted", "Lyrics lookup aborted", { cause: error });
    if (!chainTimedOut) console.warn("[VividLyrics] provider chain failed", error);
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortChain);
  }
}
