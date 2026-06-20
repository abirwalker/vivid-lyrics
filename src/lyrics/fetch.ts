import type { TransformedLyrics } from "./types";
import { query } from "../utils/query";
import { adaptLyrics } from "./adapt";
import { getLyricsFromCache, setLyricsCache, setLyricsCacheNegative } from "../utils/lyrics-cache";

async function getAccessToken(): Promise<string> {
  try {
    const result = await Spicetify.CosmosAsync.get("sp://oauth/v2/token");
    return result.accessToken;
  } catch {
    const token = (Spicetify.Platform?.Session as any)?.accessToken;
    if (token) return token;
    throw new Error("Could not obtain access token");
  }
}

function getTrackId(uri: string): string | null {
  if (!uri?.startsWith("spotify:track:")) return null;
  return uri.split(":")[2] ?? null;
}

export async function fetchLyrics(uri: string): Promise<TransformedLyrics | null> {
  const trackId = getTrackId(uri);
  if (!trackId) return null;

  const cached = getLyricsFromCache(trackId);
  if (cached !== undefined) {
    console.log("[VividLyrics] cache hit:", trackId);
    return cached;
  }

  console.log("[VividLyrics] cache miss:", trackId);

  try {
    const accessToken = await getAccessToken();
    const results = await query(
      [{ operation: "lyrics", variables: { id: trackId, auth: "SpicyLyrics-WebAuth" } }],
      { "SpicyLyrics-WebAuth": `Bearer ${accessToken}` }
    );

    const result = results.get("0");
    if (!result || result.httpStatus === 404) {
      setLyricsCacheNegative(trackId);
      return null;
    }
    if (result.httpStatus !== 200) return null;

    const lyrics = adaptLyrics(result.data);
    setLyricsCache(trackId, lyrics);
    return lyrics;
  } catch (err) {
    console.error("[VividLyrics] fetchLyrics error:", err);
    return null;
  }
}
