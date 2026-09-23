import { cleanIsrc, splitArtistNames } from "./providers/matching.ts";
import { RequestFailure } from "./providers/request.ts";
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

function findIsrc(value: unknown, depth = 0, seen = new WeakSet<object>()): string | undefined {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return undefined;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/isrc/i.test(key)) {
      const direct = cleanIsrc(child);
      if (direct) return direct;
    }
    if (child && typeof child === "object") {
      const record = child as Record<string, unknown>;
      if (String(record.type ?? "").toLowerCase() === "isrc") {
        const typed = cleanIsrc(record.id) ?? cleanIsrc(record.value);
        if (typed) return typed;
      }
      const nested = findIsrc(child, depth + 1, seen);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function resolveMetadataIsrc(
  trackId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) throw new RequestFailure("aborted", "Metadata lookup aborted");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RequestFailure("timeout", "Metadata lookup timed out")), 1500);
      abortListener = () => reject(new RequestFailure("aborted", "Metadata lookup aborted"));
      signal.addEventListener("abort", abortListener, { once: true });
    });
    const metadata = await Promise.race([
      Spicetify.CosmosAsync.get(`sp://metadata/track/${trackId}`),
      timeout,
    ]);
    return findIsrc(metadata);
  } catch (error) {
    if (error instanceof RequestFailure && error.kind === "aborted") throw error;
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

export async function buildTrackQuery(uri: string, signal: AbortSignal): Promise<TrackQuery | null> {
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

  let isrc = cleanIsrc(metadata.isrc)
    ?? cleanIsrc(metadata.isrc_id)
    ?? cleanIsrc(metadata.track_isrc)
    ?? cleanIsrc(item.isrc)
    ?? cleanIsrc(item.external_ids?.isrc);

  if (!isrc && Array.isArray(item.external_id)) {
    for (const entry of item.external_id) {
      if (String(entry?.type ?? "").toLowerCase() !== "isrc") continue;
      isrc = cleanIsrc(entry.id) ?? cleanIsrc(entry.value);
      if (isrc) break;
    }
  }
  isrc ??= findIsrc(metadata) ?? findIsrc(item);
  isrc ??= await resolveMetadataIsrc(spotifyId, signal);

  return {
    spotifyId,
    title,
    artists,
    album: String(metadata.album_title ?? item.album?.name ?? "").trim() || undefined,
    durationMs: readDurationMs(metadata.duration, item.duration, item.duration_ms),
    isrc,
  };
}
