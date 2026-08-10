import { fetchLyrics } from "../lyrics/fetch";
import type { TransformedLyrics } from "../lyrics/types";
import { fillRomanizedText } from "../lyrics/adapt";
import { on, off, emit } from "../utils/events";


let currentLyrics: TransformedLyrics | null = null;
let currentUri: string | null = null;
let currentFetchId = 0;
let lyricsLoading = false;
const inFlightLoads = new Map<string, Promise<TransformedLyrics | null>>();

export function getLyrics(): TransformedLyrics | null {
  return currentLyrics;
}

export function getUri(): string | null {
  return currentUri;
}

export function isLyricsLoading(): boolean {
  return lyricsLoading;
}

export function onLyricsChange(cb: (lyrics: TransformedLyrics | null) => void): () => void {
  const id = on("lyrics:change", cb);
  return () => off(id);
}

async function ensureRomanized(lyrics: TransformedLyrics | null): Promise<void> {
  if (!lyrics) return;

  const lang = lyrics.romanizedLanguage;
  console.log(`[VividLyrics] ensureRomanized: lang=${lang} type=${lyrics.type}`);
  if (lang !== "Japanese") {
    console.log("[VividLyrics] ensureRomanized: skipped (not Japanese)");
    return;
  }

  try {
    await fillRomanizedText(lyrics);
  } catch (err) {
    // Romanization is an enhancement; a tokenizer failure should not hide
    // otherwise valid lyrics.
    console.error("[VividLyrics] romanization failed:", err);
  }
}

export async function loadLyrics(uri: string): Promise<TransformedLyrics | null> {
  if (uri === currentUri && currentLyrics) {
    console.log(`[VividLyrics] loadLyrics: cache hit for ${uri}`);
    await ensureRomanized(currentLyrics);
    return currentLyrics;
  }

  // Reuse a request already fetching the current track. If the player moved
  // away and then back before the old request completed, do not reuse that
  // superseded promise; a fresh request will be created below.
  if (uri === currentUri) {
    const existing = inFlightLoads.get(uri);
    if (existing) {
      console.log(`[VividLyrics] loadLyrics: request already in flight for ${uri}`);
      return existing;
    }
  }

  const load = loadLyricsFresh(uri);
  inFlightLoads.set(uri, load);

  try {
    return await load;
  } finally {
    if (inFlightLoads.get(uri) === load) {
      inFlightLoads.delete(uri);
    }
  }
}

async function loadLyricsFresh(uri: string): Promise<TransformedLyrics | null> {
  console.log(`[VividLyrics] loadLyrics: fresh load for ${uri}`);
  currentUri = uri;
  currentFetchId++;
  const fetchId = currentFetchId;

  currentLyrics = null;
  lyricsLoading = true;
  emit("lyrics:change", null);

  let lyrics: TransformedLyrics | null;
  try {
    lyrics = await fetchLyrics(uri);
  } catch (err) {
    if (fetchId !== currentFetchId) return null;
    console.error("[VividLyrics] lyrics load failed:", err);
    lyricsLoading = false;
    emit("lyrics:change", null);
    return null;
  }

  // A superseded request must not publish a null update. The newer request
  // owns the UI state and will publish its result when it completes.
  if (fetchId !== currentFetchId) return null;

  currentLyrics = lyrics;
  await ensureRomanized(lyrics);

  // Romanization can be asynchronous, so the request may have become stale
  // while it was running.
  if (fetchId !== currentFetchId) return null;

  lyricsLoading = false;
  emit("lyrics:change", lyrics);

  if (lyrics?.romanizedLanguage) {
    console.log(`[VividLyrics] detected language: ${lyrics.romanizedLanguage}`);
  }

  return lyrics;
}

export function clearLyrics(): void {
  currentLyrics = null;
  currentUri = null;
  lyricsLoading = false;
  currentFetchId++;
  emit("lyrics:change", null);
}
