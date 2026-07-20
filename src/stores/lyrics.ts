import { fetchLyrics } from "../lyrics/fetch";
import type { TransformedLyrics } from "../lyrics/types";
import { fillRomanizedText } from "../lyrics/adapt";
import { on, off, emit } from "../utils/events";

function showLangNotification(lang: string): void {
  const existing = document.getElementById("VL-LangToast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "VL-LangToast";
  toast.textContent = `Lang: ${lang}`;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "80px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "9999",
    background: "rgba(80, 40, 160, 0.92)",
    color: "#fff",
    padding: "12px 28px",
    borderRadius: "8px",
    fontSize: "18px",
    fontWeight: "600",
    letterSpacing: "0.5px",
    pointerEvents: "none",
    transition: "opacity 0.4s ease",
    backdropFilter: "blur(8px)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  });
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 6000);
  });
}

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

async function ensureRomanized(lyrics: TransformedLyrics): Promise<void> {
  const lang = lyrics.romanizedLanguage;
  console.log(`[VividLyrics] ensureRomanized: lang=${lang} type=${lyrics.type}`);
  if (lang !== "Japanese") {
    console.log("[VividLyrics] ensureRomanized: skipped (not Japanese)");
    return;
  }
  await fillRomanizedText(lyrics);
}

export async function loadLyrics(uri: string): Promise<TransformedLyrics | null> {
  if (uri === currentUri && currentLyrics) {
    console.log(`[VividLyrics] loadLyrics: cache hit for ${uri}`);
    await ensureRomanized(currentLyrics);
    return currentLyrics;
  }

  console.log(`[VividLyrics] loadLyrics: fresh load for ${uri}`);
  currentUri = uri;
  currentFetchId++;
  const fetchId = currentFetchId;

  currentLyrics = null;
  emit("lyrics:change", null);

  const lyrics = await fetchLyrics(uri);
  if (fetchId !== currentFetchId) {
    emit("lyrics:change", null);
    return null;
  }

  currentLyrics = lyrics;

  await ensureRomanized(lyrics);

  emit("lyrics:change", lyrics);

  if (lyrics?.romanizedLanguage) {
    showLangNotification(lyrics.romanizedLanguage);
  }

  return lyrics;
}

export function clearLyrics(): void {
  currentLyrics = null;
  currentUri = null;
  currentFetchId++;
  emit("lyrics:change", null);
}
