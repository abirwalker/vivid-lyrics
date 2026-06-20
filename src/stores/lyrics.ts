import { fetchLyrics } from "../lyrics/fetch";
import type { TransformedLyrics } from "../lyrics/types";
import { on, off, emit } from "../utils/events";

let currentLyrics: TransformedLyrics | null = null;
let currentUri: string | null = null;
let currentFetchId = 0;

export function getLyrics(): TransformedLyrics | null {
  return currentLyrics;
}

export function getUri(): string | null {
  return currentUri;
}

export function onLyricsChange(cb: (lyrics: TransformedLyrics | null) => void): () => void {
  const id = on("lyrics:change", cb);
  return () => off(id);
}

export async function loadLyrics(uri: string): Promise<TransformedLyrics | null> {
  if (uri === currentUri && currentLyrics) return currentLyrics;

  currentUri = uri;
  currentFetchId++;
  const fetchId = currentFetchId;

  emit("lyrics:loading");
  currentLyrics = null;

  const lyrics = await fetchLyrics(uri);
  if (fetchId !== currentFetchId) return null;

  currentLyrics = lyrics;
  emit("lyrics:change", lyrics);
  return lyrics;
}

export function clearLyrics(): void {
  currentLyrics = null;
  currentUri = null;
  currentFetchId++;
  emit("lyrics:change", null);
}
