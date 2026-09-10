import type { TransformedLyrics } from "./types";
import { query } from "./api";
import { adaptLyrics } from "./adapt";
import { unpackLyrics } from "./unpack";
import { getLyricsFromCache, setLyricsCache, setLyricsCacheNegative } from "./cache";

async function getAccessToken(): Promise<string> {
  try {
    const state = (Spicetify.Platform as any)?.AuthorizationAPI?.getState?.();
    const token = state?.token?.accessToken;
    if (state?.isAuthorized !== false && typeof token === "string" && token.trim()) {
      return token;
    }
  } catch {
    // Older clients may not expose the authorization store.
  }

  try {
    const result = await Spicetify.CosmosAsync.get("sp://oauth/v2/token");
    const token = result?.accessToken;
    if (typeof token === "string" && token.trim()) return token;
  } catch {
    // The legacy OAuth resolver is unavailable on some Spotify clients.
  }

  const token = (Spicetify.Platform?.Session as any)?.accessToken;
  if (typeof token === "string" && token.trim()) return token;
  throw new Error("Could not obtain access token from Spotify authorization or legacy sources");
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

     console.log("[VividLyrics] ===== RAW API RESPONSE =====");
     console.log("[VividLyrics] httpStatus:", result?.httpStatus);
     console.log("[VividLyrics] raw data:", JSON.stringify(result?.data, null, 2));
     console.log("[VividLyrics] ============================");

     if (!result || result.httpStatus === 404) {
       setLyricsCacheNegative(trackId);
       return null;
     }
     if (result.httpStatus !== 200) return null;

     const lyrics = adaptLyrics(unpackLyrics(result.data));
    setLyricsCache(trackId, lyrics);
    return lyrics;
  } catch (err) {
    console.error("[VividLyrics] fetchLyrics error:", err);
    return null;
  }
}
