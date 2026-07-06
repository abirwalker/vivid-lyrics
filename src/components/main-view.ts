import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange } from "../stores/lyrics";
import { setPageMode } from "../stores/page";
import { get } from "../stores/settings";
import { whyamidoingthis, getNoLyricsMessage } from "../utils/no-lyrics-messages";
import { setLyricsVisibility } from "./card-view";
import LyricsRenderer from "../modules/lyrics-renderer";
import SimpleBar from "simplebar";
import "simplebar/dist/simplebar.css";

const BASE_ROUTE = "/vivid-lyrics";
const CinemaIcon = `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M18.6,26.6,8,37.2V30.1A2.1,2.1,0,0,0,6.3,28,2,2,0,0,0,4,30V42a2,2,0,0,0,2,2H17.9A2.1,2.1,0,0,0,20,42.3,2,2,0,0,0,18,40H10.8L21.3,29.5a2.1,2.1,0,0,0,.3-2.7A1.9,1.9,0,0,0,18.6,26.6Z"/><path d="M30,4a2,2,0,0,0-2,2.3A2.1,2.1,0,0,0,30.1,8h7.1L26.7,18.5a2,2,0,0,0-.2,2.8A1.8,1.8,0,0,0,28,22a2,2,0,0,0,1.4-.6L40,10.8v7.1A2.1,2.1,0,0,0,41.7,20,2,2,0,0,0,44,18V6a2,2,0,0,0-2-2Z"/></svg>`;
const ShrinkIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0,0L16,0L16,16L0,16L0,0ZM12,14L12,2L2,2L2,14L12,14ZM5.586,5.414L8.172,8L5.586,10.586L7,12L11,8L7,4L5.586,5.414Z"/></svg>`;

let pageContainer: HTMLDivElement | null = null;
let hiddenSiblings: HTMLElement[] = [];
let isOpen = false;
let isLoading = false;
let lastUri: string | null = null;
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
    if (isLoading) {
      const skeleton = document.createElement("div");
      skeleton.className = "VL-Skeleton";
    for (let i = 0; i < 20; i++) {
        const line = document.createElement("div");
        line.className = "VL-SkeletonLine";
        skeleton.appendChild(line);
      }
      content.appendChild(skeleton);
    } else {
      content.innerHTML = `<div class="VL-NoLyrics">${getNoLyricsMessage()}</div>`;
    }
    return;
  }

  isLoading = false;

  if (lyrics.type === "Static") {
    const scroll = document.createElement("div");
    scroll.className = "LyricsScrollContainer";
    scroll.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    const lyricsContainer = document.createElement("div");
    lyricsContainer.className = "Lyrics";
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
      p.className = "VL-FS-Line";
      lyricsContainer.appendChild(p);
    }
    scroll.appendChild(lyricsContainer);
    new SimpleBar(scroll, { autoHide: false });
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

function open(): void {
  if (isOpen) return;
  isOpen = true;

  const pageRoot = getPageRoot();
  if (!pageRoot) return;

  pageContainer = document.createElement("div");
  pageContainer.id = "VividLyrics-MainPage";

  const content = document.createElement("div");
  content.className = "VividLyrics-PageContent";

  const controls = document.createElement("div");
  controls.className = "VL-MainControls";
  const cinemaBtn = document.createElement("button");
  cinemaBtn.className = "VL-MainControlBtn";
  cinemaBtn.title = "Cinema Mode";
  cinemaBtn.innerHTML = CinemaIcon;
  cinemaBtn.addEventListener("click", () => setPageMode("cinema"));
  controls.appendChild(cinemaBtn);

  const shrinkBtn = document.createElement("button");
  shrinkBtn.className = "VL-MainControlBtn";
  shrinkBtn.title = "Shrink to Now Playing";
  shrinkBtn.innerHTML = ShrinkIcon;
  shrinkBtn.addEventListener("click", () => {
    (Spicetify.Platform.History as any).goBack();
    setTimeout(() => setLyricsVisibility(true), 100);
  });
  controls.appendChild(shrinkBtn);

  pageContainer.appendChild(content);
  pageContainer.appendChild(controls);

  hiddenSiblings = Array.from(pageRoot.children).filter(
    (el) => el !== pageContainer
  ) as HTMLElement[];
  for (const el of hiddenSiblings) {
    el.style.display = "none";
  }

  pageRoot.prepend(pageContainer);
  pageRoot.scrollTop = 0;

  const uri = Spicetify.Player.data?.item?.uri;
  if (uri) {
    isLoading = true;
    const skeleton = document.createElement("div");
    skeleton.className = "VL-Skeleton";
    for (let i = 0; i < 20; i++) {
      const line = document.createElement("div");
      line.className = "VL-SkeletonLine";
      skeleton.appendChild(line);
    }
    content.appendChild(skeleton);
    loadLyrics(uri).then((lyrics) => {
      if (isOpen) renderPage(lyrics);
    });
  }

  lyricsUnsub = onLyricsChange((lyrics) => {
    if (isOpen) {
      const currentUri = Spicetify.Player.data?.item?.uri ?? null;
      if (currentUri !== lastUri) {
        isLoading = true;
        lastUri = currentUri;
      } else {
        isLoading = false;
      }
      renderPage(lyrics);
    }
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
