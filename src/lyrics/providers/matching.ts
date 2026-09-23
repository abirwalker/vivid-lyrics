import { isKana, isRomaji, toRomaji } from "wanakana";
import type { TrackQuery } from "./types.ts";

const VERSION_MARKER = /\b(remix|stripped|acoustic|live|instrumental|karaoke|sped[ -]?up|slowed|rework|vip|demo|radio[ -]?edit)\b/gi;

export type MatchCandidate = {
  titles: string[];
  artists: string[];
  albums?: string[];
  durationMs?: number;
  spotifyIds?: string[];
};

export function normalizeMatchText(value?: string): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\s*(\(|\[)\s*(with|feat\.?|ft\.?)\b[^)\]]*(\)|\])/gi, "")
    .replace(/\s*[-–—]\s*(with|feat\.?|ft\.?)\b.*$/gi, "")
    .trim();
}

export function splitArtistNames(values: string[]): string[] {
  const result = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/gi)) {
      const trimmed = part.trim();
      if (trimmed) result.add(trimmed);
    }
  }
  return [...result];
}

function versionMarkers(value: string): Set<string> {
  return new Set([...value.matchAll(VERSION_MARKER)].map((match) => normalizeMatchText(match[0])));
}

function textMatches(left: string, right: string): boolean {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min([...a].length, [...b].length) < 4) return false;
  return a.includes(b) || b.includes(a);
}

function artistMatches(requested: string[], candidates: string[]): boolean {
  const requestedParts = splitArtistNames(requested);
  const candidateParts = splitArtistNames(candidates);
  return requestedParts.some((artist) => candidateParts.some((candidate) => {
    if (textMatches(artist, candidate)) return true;
    const kana = isKana(artist) ? artist : isKana(candidate) ? candidate : null;
    const latin = isRomaji(artist) ? artist : isRomaji(candidate) ? candidate : null;
    if (!kana || !latin) return false;
    const romanized = normalizeMatchText(toRomaji(kana)).replaceAll(" ", "");
    return romanized.length >= 4 && romanized === normalizeMatchText(latin).replaceAll(" ", "");
  }));
}

function hasUnexpectedVersion(query: TrackQuery, candidate: MatchCandidate): boolean {
  const requested = versionMarkers(query.title);
  return candidate.titles.some((title) =>
    [...versionMarkers(title)].some((marker) => !requested.has(marker)),
  );
}

export function scoreCandidate(query: TrackQuery, candidate: MatchCandidate): number | null {
  if (candidate.spotifyIds?.includes(query.spotifyId)) return 950;
  if (hasUnexpectedVersion(query, candidate)) return null;

  const exactTitle = candidate.titles.some(
    (title) => normalizeMatchText(title) === normalizeMatchText(query.title),
  );
  const looseTitle = candidate.titles.some((title) => textMatches(title, query.title));
  if (!looseTitle) return null;

  const matchedArtist = artistMatches(query.artists, candidate.artists);
  if (!matchedArtist) return null;

  let score = exactTitle ? 120 : 55;
  score += 80;

  if (query.album && candidate.albums?.some((album) => textMatches(album, query.album!))) {
    score += 20;
  }
  if (query.durationMs && candidate.durationMs) {
    const difference = Math.abs(query.durationMs - candidate.durationMs);
    if (difference <= 2000) score += 80;
    else if (difference <= 4000) score += 35;
    else if (difference > 10000) return null;
  }
  return score;
}
