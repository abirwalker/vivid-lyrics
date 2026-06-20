import type { TransformedLyrics } from "./types";
import { query } from "../utils/query";
import { adaptLyrics } from "./adapt";

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
  console.log("[VividLyrics] fetchLyrics trackId:", trackId);
  if (!trackId) return null;

  try {
    const accessToken = await getAccessToken();
    console.log("[VividLyrics] accessToken:", accessToken ? "ok" : "missing");
    const results = await query(
      [{ operation: "lyrics", variables: { id: trackId, auth: "SpicyLyrics-WebAuth" } }],
      { "SpicyLyrics-WebAuth": `Bearer ${accessToken}` }
    );

    const result = results.get("0");
    console.log("[VividLyrics] result:", result?.httpStatus, result?.data ? "has data" : "no data");
    if (!result || result.httpStatus === 404) return null;
    if (result.httpStatus !== 200) return null;

    return adaptLyrics(result.data);
  } catch (err) {
    console.error("[VividLyrics] fetchLyrics error:", err);
    return null;
  }
}
