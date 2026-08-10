import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, getLyrics, onLyricsChange, isLyricsLoading } from "../stores/lyrics";
import { setPageMode } from "../stores/page";
import { get, onSettingsChange } from "../stores/settings";
import { getNoLyricsMessage } from "../utils/no-lyrics-messages";
import { setLyricsVisibility } from "./card-view";
import LyricsRenderer from "../modules/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../stores/romanize";
import SimpleBar from "simplebar";
import "simplebar/dist/simplebar.css";

const BASE_ROUTE = "/vivid-lyrics";
const CinemaIcon = `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M18.6,26.6,8,37.2V30.1A2.1,2.1,0,0,0,6.3,28,2,2,0,0,0,4,30V42a2,2,0,0,0,2,2H17.9A2.1,2.1,0,0,0,20,42.3,2,2,0,0,0,18,40H10.8L21.3,29.5a2.1,2.1,0,0,0,.3-2.7A1.9,1.9,0,0,0,18.6,26.6Z"/><path d="M30,4a2,2,0,0,0-2,2.3A2.1,2.1,0,0,0,30.1,8h7.1L26.7,18.5a2,2,0,0,0-.2,2.8A1.8,1.8,0,0,0,28,22a2,2,0,0,0,1.4-.6L40,10.8v7.1A2.1,2.1,0,0,0,41.7,20,2,2,0,0,0,44,18V6a2,2,0,0,0-2-2Z"/></svg>`;
const ShrinkIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0,0L16,0L16,16L0,16L0,0ZM12,14L12,2L2,2L2,14L12,14ZM5.586,5.414L8.172,8L5.586,10.586L7,12L11,8L7,4L5.586,5.414Z"/></svg>`;
const RomanizeOnIcon = `<svg role="img" height="20" width="20" aria-hidden="true" viewBox="0 0 750 900" fill="currentColor"><path d="m529.42,632.32H214.71l-81.89,163.5H13.31L377.06,80.35l350.9,715.47h-121.41l-77.13-163.5Zm-45.23-95.48l-109.03-228.9-114.27,228.9h223.3Z"></path></svg>`;
const RomanizeOffIcon = `<svg role="img" height="17" width="17" aria-hidden="true" viewBox="0 0 125.45 131.07" fill="currentColor"><path d="m53.38,130.41c-12.54-2.87-20.86-14.36-19.98-27.42.59-7.62,5.8-15.12,13.07-18.69,4.28-2.11,11.02-3.4,17.75-3.46h4.8v-12.71c.06-16,.64-17.99,5.98-20.74,4.86-2.46,10.96-.47,13.3,4.34,1.17,2.34,1.23,3.52,1.23,17.23v14.65l2.81,1.05c13.59,5.1,30.59,17.87,32.34,24.38,1.17,4.34-.88,8.79-4.92,10.72-4.1,1.93-5.63,1.41-13.89-5.27-4.69-3.69-12.83-9.02-15.29-9.96-.88-.29-1.05,0-1.05,1.64,0,2.93-1.58,8.5-3.34,11.78-1.93,3.46-6.74,8.03-10.43,9.79-6.21,2.99-15.88,4.16-22.38,2.7v-.03Zm11.84-20.51c1.05-.47,2.4-1.46,2.87-2.29,1-1.52,1.41-5.39.7-6.15-.64-.59-12.66-.18-13.95.53-1.23.64-1.46,4.92-.29,6.45,1.82,2.34,6.86,3.05,10.66,1.46h0Z"></path><path d="m6.33,103.4c-4.39-1.99-6.91-6.04-6.21-9.9.23-1.11,2.23-4.8,4.51-8.32,7.21-11.19,17.64-31.23,18.98-36.56l.35-1.46h-8.67c-7.62,0-8.91-.18-10.66-1.17-2.99-1.76-4.34-3.93-4.34-6.91,0-3.52,1.64-6.04,5.1-7.73,2.81-1.41,3.4-1.46,13.89-1.46h10.96l.64-3.93c.35-2.23,1.05-6.86,1.58-10.43,1-7.21,1.93-9.79,4.22-12.19,2.34-2.46,4.39-3.34,7.85-3.34,5.74,0,9.26,3.34,9.26,8.79,0,1.46-.64,5.8-1.46,9.67-.76,3.87-1.46,7.27-1.46,7.56,0,.94,2.99-.29,7.97-3.28,6.04-3.57,9.32-4.22,12.42-2.23,4.51,2.81,4.92,10.84.82,16.35-2.7,3.63-10.9,6.33-20.92,6.91l-6.45.35-1.99,5.33c-3.63,9.67-9.43,22.73-15.35,34.34-6.74,13.3-9.43,17.64-11.72,18.98-2.46,1.46-6.86,1.76-9.32.64h0Z"></path><path d="m109.17,57.17c-11.19-4.69-29.82-13.3-30.88-14.24-4.69-4.22-3.46-12.42,2.17-15.12,4.28-1.99,6.56-1.29,24.9,7.73,15.12,7.38,16.88,8.44,18.34,10.61,1.99,2.87,2.34,6.8.76,9.2-1.29,1.99-5.21,3.81-8.26,3.81-1.35,0-4.34-.88-7.03-1.99Z"></path></svg>`;

let pageContainer: HTMLDivElement | null = null;
let hiddenSiblings: HTMLElement[] = [];
let isOpen = false;
let isLoading = false;

let lyricsUnsub: (() => void) | null = null;
let romanizeUnsub: (() => void) | null = null;
let settingsUnsub: (() => void) | null = null;
let activeRenderer: LyricsRenderer | null = null;
let romanizeBtn: HTMLButtonElement | null = null;

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
    const showRomanized = getRomanize();
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = showRomanized ? (line.romanizedText ?? line.text) : line.text;
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

function updateMainRomanizeBtn(): void {
  if (!romanizeBtn) return;
  const show = getRomanize();
  romanizeBtn.innerHTML = show ? RomanizeOffIcon : RomanizeOnIcon;
  romanizeBtn.title = show ? "Show Original Text" : "Show Romanized Text";
  romanizeBtn.style.display = hasRomanizeCapability() && get("romanization") ? "" : "none";
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

  romanizeBtn = document.createElement("button");
  romanizeBtn.className = "VL-MainControlBtn";
  romanizeBtn.title = "Show Romanized Text";
  romanizeBtn.innerHTML = RomanizeOnIcon;
  romanizeBtn.addEventListener("click", () => toggleRomanize());
  controls.appendChild(romanizeBtn);
  updateMainRomanizeBtn();

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
      if (isOpen && (Spicetify.Player.data?.item?.uri ?? null) === uri) {
        isLoading = isLyricsLoading();
        renderPage(lyrics);
      }
    });
  }

  lyricsUnsub = onLyricsChange((lyrics) => {
    if (isOpen) {
      isLoading = isLyricsLoading();
      if (lyrics) {
        const canRomanize = !!(lyrics.romanizedLanguage && lyrics.romanizedLanguage !== "Latin");
        resetRomanize(canRomanize);
      }
      renderPage(lyrics);
    }
  });

  romanizeUnsub = onRomanizeChange(() => {
    if (isOpen) {
      updateMainRomanizeBtn();
      isLoading = isLyricsLoading();
      renderPage(getLyrics());
    }
  });

  settingsUnsub = onSettingsChange(({ key }) => {
    if (!isOpen) return;
    if (
      key !== null &&
      key !== "fontSize" &&
      key !== "fontFamily" &&
      key !== "gradientDirection" &&
      key !== "scrollMode" &&
      key !== "romanization"
    ) {
      return;
    }
    updateMainRomanizeBtn();
    isLoading = isLyricsLoading();
    renderPage(getLyrics());
  });
}

function closePage(): void {
  if (!isOpen) return;
  isOpen = false;

  lyricsUnsub?.();
  lyricsUnsub = null;
  romanizeUnsub?.();
  romanizeUnsub = null;
  settingsUnsub?.();
  settingsUnsub = null;

  activeRenderer?.destroy();
  activeRenderer = null;

  pageContainer?.remove();
  pageContainer = null;
  romanizeBtn = null;

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
