import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange } from "../stores/lyrics";
import { setPageMode } from "../stores/page";
import { get } from "../stores/settings";
import storage from "../utils/storage";
import { whyamidoingthis, getNoLyricsMessage, resetNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";
import "../styles/lyrics.scss";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

const CloseIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>`;
const LyricsIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1h-11A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1Zm-7 11H4V9h2.5v3Zm4 0H8V5h2.5v7Zm2.5 0h-2.5V7H16v5a1 1 0 0 1-1 1Z"/></svg>`;

let card: HTMLDivElement | null = null;
let header: HTMLDivElement | null = null;
let title: HTMLDivElement | null = null;
let showBtn: HTMLButtonElement | null = null;
let closeBtn: HTMLButtonElement | null = null;
let body: HTMLDivElement | null = null;
let renderer: LyricsRenderer | null = null;
let currentLyrics: TransformedLyrics | null = null;
let currentUri: string | null = null;

function getVisible(): boolean {
  return storage.get("CardLyricsVisible") !== "false";
}

function setVisible(visible: boolean): void {
  storage.set("CardLyricsVisible", String(visible));
}

function getTrackUri(): string | null {
  return Spicetify.Player.data?.item?.uri ?? null;
}

function ensureCard(): void {
  if (card) return;

  card = document.createElement("div");
  card.id = "VividLyrics-Card";

  header = document.createElement("div");
  header.className = "VL-CardHeader";

  title = document.createElement("div");
  title.className = "VL-CardTitle";
  title.textContent = "Lyrics";
  header.appendChild(title);

  showBtn = document.createElement("button");
  showBtn.className = "VL-ShowBtn";
  showBtn.textContent = "Show lyrics";
  showBtn.addEventListener("click", () => setLyricsVisibility(true));
  header.appendChild(showBtn);

  closeBtn = document.createElement("button");
  closeBtn.className = "VL-CloseBtn";
  closeBtn.title = "Hide lyrics";
  closeBtn.innerHTML = CloseIcon;
  closeBtn.addEventListener("click", () => setLyricsVisibility(false));

  card.appendChild(header);

  if (get("centeredTextCard")) {
    card.classList.add("vl-card-centered");
  }

  body = document.createElement("div");
  body.className = "VL-LyricsBody";
  body.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
  card.appendChild(body);
}

function destroyRenderer(): void {
  renderer?.destroy();
  renderer = null;
}

function clearBody(): void {
  if (!body) return;
  destroyRenderer();
  body.innerHTML = "";
}

function populateBody(lyrics: TransformedLyrics): void {
  if (!body) return;

  if (lyrics.type === "Static") {
    const scroll = document.createElement("div");
    scroll.className = "LyricsScrollContainer";
    scroll.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    for (const line of lyrics.lines) {
      const lineEl = document.createElement("div");
      lineEl.className = "VL-FS-Line";
      lineEl.textContent = line.text;
      scroll.appendChild(lineEl);
    }
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VL-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      scroll.appendChild(credits);
    }
    body.appendChild(scroll);
  } else {
    renderer = new LyricsRenderer(body, lyrics);
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VL-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      renderer.appendCredits(credits);
    }
  }
}

function setLyricsVisibility(visible: boolean): void {
  setVisible(visible);
  reactToVisibility();
}

function reactToVisibility(): void {
  ensureCard();

  const visible = getVisible();

  if (visible) {
    header!.appendChild(closeBtn!);
    showBtn!.remove();
    body!.style.display = "";

    if (currentLyrics) {
      clearBody();
      populateBody(currentLyrics);
    } else {
      clearBody();
      const loading = document.createElement("div");
      loading.className = "VL-StatusText";
      loading.textContent = "Loading lyrics...";
      body!.appendChild(loading);
      const uri = getTrackUri();
      if (uri) loadLyrics(uri);
    }
  } else {
    header!.appendChild(showBtn!);
    closeBtn!.remove();
    clearBody();
    body!.style.display = "none";
  }

  ensureInDOM();
}

function showNoLyrics(): void {
  ensureCard();
  header!.appendChild(closeBtn!);
  showBtn!.remove();
  clearBody();
  const container = document.createElement("div");
  container.id = "VividLyrics-NoLyrics";
  const noLyrics = document.createElement("p");
  noLyrics.className = "VL-StatusText";
  noLyrics.textContent = getNoLyricsMessage();
  container.appendChild(noLyrics);
  body!.appendChild(container);
  ensureInDOM();
}

function ensureInDOM(): void {
  if (!card) return;
  if (card.parentElement) return;
  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

function onLyricsUpdate(lyrics: TransformedLyrics | null) {
  currentLyrics = lyrics;
  if (!getVisible()) return;

  if (lyrics) {
    clearBody();
    populateBody(lyrics);
  } else {
    showNoLyrics();
  }
}

async function onSongChange() {
  const uri = getTrackUri();
  console.log("[VividLyrics] songChange uri:", uri);
  if (!uri) return;
  currentUri = uri;
  resetNoLyricsMessage();

  if (!getVisible()) {
    reactToVisibility();
    return;
  }

  ensureCard();
  header!.appendChild(closeBtn!);
  showBtn!.remove();
  clearBody();
  const loading = document.createElement("div");
  loading.className = "VL-StatusText";
  loading.textContent = "Loading lyrics...";
  body!.appendChild(loading);
  ensureInDOM();

  await loadLyrics(uri);
}

function suppressNativeLyrics(container: Element) {
  const native = container.querySelector<HTMLDivElement>(NATIVE_LYRICS_QUERY);
  if (native) native.style.display = "none";
}

function observeNPV() {
  let current: Element | null = null;
  let removeCb: (() => void) | null = null;
  let nativeObserver: MutationObserver | null = null;
  let lyricsUnsub: (() => void) | null = null;

  const check = () => {
    const el = document.body.querySelector(`${ANCHOR}, ${ANCHOR_FALLBACK}`);
    console.log("[VividLyrics] observeNPV check:", el ? "found" : "not found");
    if (el && el !== current) {
      if (current && removeCb) removeCb();
      current = el;

      suppressNativeLyrics(el.parentElement!);
      nativeObserver = new MutationObserver(() => suppressNativeLyrics(el.parentElement!));
      nativeObserver.observe(el.parentElement!, { childList: true });

      const handler = () => onSongChange();
      Spicetify.Player.addEventListener("songchange", handler);

      lyricsUnsub = onLyricsChange((lyrics) => onLyricsUpdate(lyrics));
      onSongChange();

      if (!getTrackUri()) {
        setTimeout(() => {
          if (!getTrackUri()) return;
          onSongChange();
        }, 1000);
      }

      removeCb = () => {
        Spicetify.Player.removeEventListener("songchange", handler);
        nativeObserver?.disconnect();
        lyricsUnsub?.();
        destroyRenderer();
        card?.remove();
        card = null;
        header = null;
        title = null;
        showBtn = null;
        closeBtn = null;
        body = null;
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
