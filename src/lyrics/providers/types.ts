import type { TransformedLyrics } from "../types.ts";

export type TrackQuery = {
  spotifyId: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
};

export type ProviderName = "BiniLyrics" | "AMLL" | "LRCLIB";

export type ProviderResult =
  | { status: "lyrics"; provider: ProviderName; lyrics: TransformedLyrics }
  | { status: "miss"; provider: ProviderName; instrumental?: boolean }
  | { status: "transient"; provider: ProviderName; reason: string };

export type Provider = {
  name: ProviderName;
  lookup(query: TrackQuery, signal: AbortSignal): Promise<ProviderResult>;
};

export type ProviderChainResult = {
  lyrics: TransformedLyrics | null;
  provider: ProviderName | null;
  definitiveMiss: boolean;
  instrumental: boolean;
};

export function isTimedLyrics(lyrics: TransformedLyrics): boolean {
  return lyrics.type === "Line" || lyrics.type === "Syllable";
}
