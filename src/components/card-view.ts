import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange } from "../stores/lyrics";
import { setPageMode } from "../stores/page";
import storage from "../utils/storage";
import LyricsRenderer from "../modules/lyrics-renderer";
import "../styles/lyrics.scss";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

const CloseIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>`;
const LyricsIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1h-11A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1Zm-7 11H4V9h2.5v3Zm4 0H8V5h2.5v7Zm2.5 0h-2.5V7H16v5a1 1 0 0 1-1 1Z"/></svg>`;

let card: HTMLDivElement | null = null;
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

function renderShowButton(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "VividLyrics-Card";

  const header = document.createElement("div");
  header.className = "VL-CardHeader";

  const title = document.createElement("div");
  title.className = "VL-CardTitle";
  title.textContent = "Lyrics";
  header.appendChild(title);

  const btn = document.createElement("button");
  btn.className = "VL-ShowBtn";
  btn.textContent = "Show lyrics";
  btn.addEventListener("click", () => setLyricsVisibility(true));
  header.appendChild(btn);

  el.appendChild(header);
  return el;
}

function renderCard(lyrics: TransformedLyrics): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "VividLyrics-Card";

  const header = document.createElement("div");
  header.className = "VL-CardHeader";

  const title = document.createElement("div");
  title.className = "VL-CardTitle";
  title.textContent = "Lyrics";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "VL-CloseBtn";
  closeBtn.title = "Hide lyrics";
  closeBtn.innerHTML = CloseIcon;
  closeBtn.addEventListener("click", () => setLyricsVisibility(false));
  header.appendChild(closeBtn);
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "VL-LyricsBody";

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      const lineEl = document.createElement("div");
      lineEl.className = "VL-FS-Line";
      lineEl.textContent = line.text;
      body.appendChild(lineEl);
    }
  } else {
    renderer = new LyricsRenderer(body, lyrics);
  }

  el.appendChild(body);

  if (lyrics.songWriters?.length) {
    const credits = document.createElement("div");
    credits.className = "VL-Credits";
    credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
    body.appendChild(credits);
  }

  const footer = document.createElement("div");
  footer.className = "VL-CardFooter";

  const viewBtn = document.createElement("button");
  viewBtn.className = "VL-CinemaBtn";
  viewBtn.title = "Open cinema view";
  viewBtn.innerHTML = LyricsIcon;
  viewBtn.addEventListener("click", () => {
    setPageMode("cinema");
  });
  footer.appendChild(viewBtn);
  el.appendChild(footer);

  return el;
}

function destroyRenderer(): void {
  renderer?.destroy();
  renderer = null;
}

function setLyricsVisibility(visible: boolean): void {
  setVisible(visible);
  reactToVisibility();
}

function reactToVisibility(): void {
  const visible = getVisible();

  if (visible) {
    if (currentLyrics) {
      showCard(currentLyrics);
    } else {
      showLoading();
      const uri = getTrackUri();
      if (uri) loadLyrics(uri);
    }
  } else {
    showShowButton();
  }
}

function showCard(lyrics: TransformedLyrics | null) {
  destroyRenderer();
  card?.remove();
  if (lyrics) {
    card = renderCard(lyrics);
  } else {
    const noLyrics = document.createElement("div");
    noLyrics.id = "VividLyrics-Card";
    noLyrics.className = "VL-Line vl-static";
    noLyrics.textContent = "No lyrics available";
    card = noLyrics;
  }
  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

function showShowButton() {
  destroyRenderer();
  card?.remove();
  card = renderShowButton();
  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

function showLoading() {
  destroyRenderer();
  card?.remove();
  const loading = document.createElement("div");
  loading.id = "VividLyrics-Card";
  loading.className = "VL-Line vl-static";
  loading.textContent = "Loading lyrics...";
  card = loading;

  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

function onLyricsUpdate(lyrics: TransformedLyrics | null) {
  currentLyrics = lyrics;
  if (getVisible()) {
    showCard(lyrics);
  }
}

async function onSongChange() {
  const uri = getTrackUri();
  console.log("[VividLyrics] songChange uri:", uri);
  if (!uri) return;
  currentUri = uri;

  if (!getVisible()) {
    showShowButton();
    return;
  }

  showLoading();
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

      removeCb = () => {
        Spicetify.Player.removeEventListener("songchange", handler);
        nativeObserver?.disconnect();
        lyricsUnsub?.();
        destroyRenderer();
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
