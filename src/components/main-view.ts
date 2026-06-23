import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange } from "../stores/lyrics";
import { setPageMode } from "../stores/page";
import { get } from "../stores/settings";
import { whyamidoingthis, getNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";

const BASE_ROUTE = "/vivid-lyrics";
let pageContainer: HTMLDivElement | null = null;
let hiddenSiblings: HTMLElement[] = [];
let isOpen = false;
let lyricsUnsub: (() => void) | null = null;
let activeRenderer: LyricsRenderer | null = null;

const PAGE_ROOT_SELECTORS = [
  ".Root__main-view .main-view-container div[data-overlayscrollbars-viewport]",
  ".Root__main-view .main-view-container .main-view-container__scroll-node-child",
  ".Root__main-view .main-view-container .os-host",
];

function getPageRoot(): HTMLElement | null {
  for (const sel of PAGE_ROOT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function renderPage(lyrics: TransformedLyrics | null): void {
  if (!pageContainer) return;

  const content = pageContainer.querySelector<HTMLElement>(".VividLyrics-PageContent")!;

  if (activeRenderer) {
    activeRenderer.destroy();
    activeRenderer = null;
  }
  content.innerHTML = "";

  if (!lyrics) {
    content.innerHTML = `<div class="VL-StatusText" style="text-align:center;">${getNoLyricsMessage()}</div>`;
    return;
  }

  if (lyrics.type === "Static") {
    const scroll = document.createElement("div");
    scroll.className = "LyricsScrollContainer";
    scroll.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
      p.className = "VL-FS-Line";
      scroll.appendChild(p);
    }
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VividLyrics-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      scroll.appendChild(credits);
    }
    content.appendChild(scroll);
  } else {
    activeRenderer = new LyricsRenderer(content, lyrics);
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VividLyrics-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      activeRenderer.appendCredits(credits);
    }
  }
}

function renderToolbar(): string {
  return `
    <div class="VividLyrics-Toolbar">
      <button id="VividLyrics-CinemaBtn" title="Cinema Mode">Cinema</button>
      <button id="VividLyrics-FullscreenBtn" title="Fullscreen">Fullscreen</button>
    </div>
  `;
}

function open(): void {
  if (isOpen) return;
  isOpen = true;

  const pageRoot = getPageRoot();
  if (!pageRoot) return;

  pageContainer = document.createElement("div");
  pageContainer.id = "VividLyrics-MainPage";
  pageContainer.innerHTML = `
    <div class="VividLyrics-PageTitle">Lyrics</div>
    ${renderToolbar()}
    <div class="VividLyrics-PageContent">Loading...</div>
  `;

  hiddenSiblings = Array.from(pageRoot.children).filter(
    (el) => el !== pageContainer
  ) as HTMLElement[];
  for (const el of hiddenSiblings) {
    el.style.display = "none";
  }

  pageRoot.prepend(pageContainer);
  pageRoot.scrollTop = 0;

  const cinemaBtn = pageContainer.querySelector<HTMLButtonElement>("#VividLyrics-CinemaBtn")!;
  const fullscreenBtn = pageContainer.querySelector<HTMLButtonElement>("#VividLyrics-FullscreenBtn")!;

  cinemaBtn.addEventListener("click", () => setPageMode("cinema"));
  fullscreenBtn.addEventListener("click", () => setPageMode("fullscreen"));

  const uri = Spicetify.Player.data?.item?.uri;
  if (uri) {
    loadLyrics(uri).then((lyrics) => {
      if (isOpen) renderPage(lyrics);
    });
  }

  lyricsUnsub = onLyricsChange((lyrics) => {
    if (isOpen) renderPage(lyrics);
  });
}

function closePage(): void {
  if (!isOpen) return;
  isOpen = false;

  lyricsUnsub?.();
  lyricsUnsub = null;

  activeRenderer?.destroy();
  activeRenderer = null;

  pageContainer?.remove();
  pageContainer = null;

  for (const el of hiddenSiblings) {
    el.style.display = "";
  }
  hiddenSiblings = [];
}

function onHistoryEvent(event: any): void {
  const path = event?.state?.pathname ?? event?.pathname ?? "";
  if (path.startsWith(BASE_ROUTE)) {
    open();
  } else {
    closePage();
  }
}

export function setupMainPage(): void {
  (Spicetify.Platform.History as any).listen(onHistoryEvent);

  const current = (Spicetify.Platform.History as any).location;
  if (current?.pathname?.startsWith(BASE_ROUTE)) {
    open();
  }
}
