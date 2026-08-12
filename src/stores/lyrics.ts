import { fetchLyrics } from "../lyrics/fetch";
import type { TransformedLyrics } from "../lyrics/types";
import { fillRomanizedText } from "../lyrics/adapt";
import { on, off, emit } from "../utils/events";


let currentLyrics: TransformedLyrics | null = null;
let currentUri: string | null = null;
let currentFetchId = 0;
let lyricsLoading = false;
const inFlightLoads = new Map<string, Promise<TransformedLyrics | null>>();
const completedRomanizations = new WeakSet<TransformedLyrics>();
const inFlightRomanizations = new WeakMap<TransformedLyrics, Promise<void>>();

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
  if (
    lang !== "Japanese" && lang !== "Chinese" && lang !== "Cantonese" &&
    lang !== "Korean" && lang !== "Thai" && lang !== "Bengali"
  ) {
    return;
  }

  if (completedRomanizations.has(lyrics)) return;
  const existing = inFlightRomanizations.get(lyrics);
  if (existing) return existing;

  console.log(`[VividLyrics] ensureRomanized: lang=${lang} type=${lyrics.type}`);
  const load = fillRomanizedText(lyrics)
    .then(() => {
      completedRomanizations.add(lyrics);
    })
    .catch((err) => {
      // Romanization is an enhancement; a tokenizer failure should not hide
      // otherwise valid lyrics. Leave it incomplete so a later call can retry.
      console.error("[VividLyrics] romanization failed:", err);
    })
    .finally(() => {
      inFlightRomanizations.delete(lyrics);
    });
  inFlightRomanizations.set(lyrics, load);
  return load;
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
  lyricsLoading = false;
  emit("lyrics:change", lyrics);

  if (lyrics?.romanizedLanguage) {
    console.log(`[VividLyrics] detected language: ${lyrics.romanizedLanguage}`);
  }

  // Render original lyrics immediately. Romanization may include the one-time
  // WASM/dictionary startup cost, so publish it as a background enhancement.
  void ensureRomanized(lyrics).then(() => {
    if (fetchId !== currentFetchId || currentLyrics !== lyrics) return;
    emit("lyrics:change", lyrics);
  });

  return lyrics;
}

export function clearLyrics(): void {
  currentLyrics = null;
  currentUri = null;
  lyricsLoading = false;
  currentFetchId++;
  emit("lyrics:change", null);
}
