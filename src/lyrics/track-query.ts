import { splitArtistNames } from "./providers/matching.ts";
import type { TrackQuery } from "./providers/types.ts";

export function getSpotifyTrackId(uri: string): string | null {
  if (!uri.startsWith("spotify:track:")) return null;
  const trackId = uri.slice("spotify:track:".length);
  return trackId || null;
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

export function readDurationMs(...values: unknown[]): number | undefined {
  for (const value of values) {
    const direct = positiveNumber(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const nested = positiveNumber(record.milliseconds)
      ?? positiveNumber(record.ms)
      ?? positiveNumber(record.totalMilliseconds)
      ?? positiveNumber(record.value);
    if (nested) return nested;
  }
  return undefined;
}

export function buildTrackQuery(uri: string): TrackQuery | null {
  const spotifyId = getSpotifyTrackId(uri);
  if (!spotifyId) return null;

  const item = Spicetify.Player.data?.item as any;
  if (!item || (item.uri && item.uri !== uri)) return null;
  const metadata = item.metadata ?? {};
  const title = String(metadata.title ?? item.name ?? "").trim();
  const structuredArtists = Array.isArray(item.artists)
    ? item.artists.map((artist: any) => String(artist?.name ?? "").trim()).filter(Boolean)
    : [];
  const metadataArtists = [metadata.artist_name, metadata.artist]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const artists = splitArtistNames(structuredArtists.length ? structuredArtists : metadataArtists);
  if (!title || !artists.length) return null;

  return {
    spotifyId,
    title,
    artists,
    album: String(metadata.album_title ?? item.album?.name ?? "").trim() || undefined,
    durationMs: readDurationMs(metadata.duration, item.duration, item.duration_ms),
  };
}
