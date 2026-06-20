import { fetchLyrics } from "../lyrics/fetch";
import type { TransformedLyrics } from "../lyrics/types";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

let card: HTMLDivElement | null = null;
let currentFetchId = 0;

function getTrackUri(): string | null {
  return Spicetify.Player.data?.item?.uri ?? null;
}

function renderCard(lyrics: TransformedLyrics): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "VividLyrics-Card";
  el.style.cssText = "padding:16px;color:var(--text-base);font-size:14px;line-height:1.8;";

  const title = document.createElement("div");
  title.textContent = "Lyrics";
  title.style.cssText = "font-weight:700;font-size:16px;margin-bottom:12px;";
  el.appendChild(title);

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
      p.style.cssText = "opacity:0.7;";
      el.appendChild(p);
    }
  } else {
    const content = "content" in lyrics ? (lyrics as any).content : [];
    for (const item of content) {
      if (item.Type === "Interlude") continue;
      const text = item.Text ?? item.Lead?.Syllables?.map((s: any) => s.Text).join("") ?? "";
      if (!text) continue;

      const p = document.createElement("div");
      p.textContent = text;
      p.style.cssText = "opacity:0.7;";
      p.dataset.startTime = String(item.StartTime ?? item.Lead?.StartTime ?? 0);
      p.style.cursor = "pointer";
      p.addEventListener("click", () => {
        const t = parseFloat(p.dataset.startTime ?? "0");
        Spicetify.Player.seek(t * 1000);
      });
      el.appendChild(p);
    }
  }

  if (lyrics.songWriters?.length) {
    const credits = document.createElement("div");
    credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
    credits.style.cssText = "margin-top:16px;font-size:12px;opacity:0.4;";
    el.appendChild(credits);
  }

  return el;
}

async function onSongChange() {
  const uri = getTrackUri();
  console.log("[VividLyrics] songChange uri:", uri);
  if (!uri) return;

  currentFetchId++;
  const fetchId = currentFetchId;

  // Clean previous card
  card?.remove();
  card = null;

  // Loading state
  const loading = document.createElement("div");
  loading.id = "VividLyrics-Card";
  loading.style.cssText = "padding:16px;color:var(--text-base);font-size:14px;opacity:0.5;";
  loading.textContent = "Loading lyrics...";
  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(loading);

  const lyrics = await fetchLyrics(uri);
  if (fetchId !== currentFetchId) return;

  loading.remove();

  if (lyrics) {
    card = renderCard(lyrics);
    const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
    if (anchor) anchor.after(card);
  }
}

function suppressNativeLyrics(container: Element) {
  const native = container.querySelector<HTMLDivElement>(NATIVE_LYRICS_QUERY);
  if (native) native.style.display = "none";
}

function observeNPV() {
  let current: Element | null = null;
  let removeCb: (() => void) | null = null;
  let nativeObserver: MutationObserver | null = null;

  const check = () => {
    const el = document.body.querySelector(`${ANCHOR}, ${ANCHOR_FALLBACK}`);
    console.log("[VividLyrics] observeNPV check:", el ? "found" : "not found");
    if (el && el !== current) {
      if (current && removeCb) removeCb();
      current = el;

      // Suppress native lyrics
      suppressNativeLyrics(el.parentElement!);
      nativeObserver = new MutationObserver(() => suppressNativeLyrics(el.parentElement!));
      nativeObserver.observe(el.parentElement!, { childList: true });

      // Song change listener
      const handler = () => onSongChange();
      Spicetify.Player.addEventListener("songchange", handler);
      onSongChange(); // trigger for current song

      removeCb = () => {
        Spicetify.Player.removeEventListener("songchange", handler);
        nativeObserver?.disconnect();
        currentFetchId++;
        card?.remove();
        card = null;
      };
    } else if (!el && current) {
      if (removeCb) removeCb();
      removeCb = null;
      current = null;
    }
  };

  const observer = new MutationObserver(check);
  check();
  observer.observe(document.body, { childList: true, subtree: true });
}

export function setupCardView() {
  observeNPV();
}
