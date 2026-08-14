import { setPageMode, getPageMode, onPageModeChange } from "../stores/page";
import { getLyrics, onLyricsChange, isLyricsLoading } from "../stores/lyrics";
import { get, onSettingsChange } from "../stores/settings";
import type { TransformedLyrics } from "../lyrics/types";
import { getNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../stores/romanize";
import "../styles/fullscreen.scss";

const CinemaIcon = `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M18.6,26.6,8,37.2V30.1A2.1,2.1,0,0,0,6.3,28,2,2,0,0,0,4,30V42a2,2,0,0,0,2,2H17.9A2.1,2.1,0,0,0,20,42.3,2,2,0,0,0,18,40H10.8L21.3,29.5a2.1,2.1,0,0,0,.3-2.7A1.9,1.9,0,0,0,18.6,26.6Z"/><path d="M30,4a2,2,0,0,0-2,2.3A2.1,2.1,0,0,0,30.1,8h7.1L26.7,18.5a2,2,0,0,0-.2,2.8A1.8,1.8,0,0,0,28,22a2,2,0,0,0,1.4-.6L40,10.8v7.1A2.1,2.1,0,0,0,41.7,20,2,2,0,0,0,44,18V6a2,2,0,0,0-2-2Z"/></svg>`;
const FullscreenIcon = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M30 6H42V18"/><path d="M18 6H6V18"/><path d="M30 42H42V30"/><path d="M18 42H6V30"/><path d="M42 6L29 19"/><path d="M19 29L6 42"/></svg>`;
const CloseFullscreenIcon = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M41 19H29V7"/><path d="M18 6H6V18"/><path d="M30 42H42V30"/><path d="M7 29H19V41"/><path d="M42 6L29 19"/><path d="M19 29L6 42"/></svg>`;
const CloseIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const RomanizeOnIcon = `<svg role="img" height="20" width="20" aria-hidden="true" viewBox="0 0 750 900" fill="currentColor"><path d="m529.42,632.32H214.71l-81.89,163.5H13.31L377.06,80.35l350.9,715.47h-121.41l-77.13-163.5Zm-45.23-95.48l-109.03-228.9-114.27,228.9h223.3Z"></path></svg>`;
const RomanizeOffIcon = `<svg role="img" height="17" width="17" aria-hidden="true" viewBox="0 0 125.45 131.07" fill="currentColor"><path d="m53.38,130.41c-12.54-2.87-20.86-14.36-19.98-27.42.59-7.62,5.8-15.12,13.07-18.69,4.28-2.11,11.02-3.4,17.75-3.46h4.8v-12.71c.06-16,.64-17.99,5.98-20.74,4.86-2.46,10.96-.47,13.3,4.34,1.17,2.34,1.23,3.52,1.23,17.23v14.65l2.81,1.05c13.59,5.1,30.59,17.87,32.34,24.38,1.17,4.34-.88,8.79-4.92,10.72-4.1,1.93-5.63,1.41-13.89-5.27-4.69-3.69-12.83-9.02-15.29-9.96-.88-.29-1.05,0-1.05,1.64,0,2.93-1.58,8.5-3.34,11.78-1.93,3.46-6.74,8.03-10.43,9.79-6.21,2.99-15.88,4.16-22.38,2.7v-.03Zm11.84-20.51c1.05-.47,2.4-1.46,2.87-2.29,1-1.52,1.41-5.39.7-6.15-.64-.59-12.66-.18-13.95.53-1.23.64-1.46,4.92-.29,6.45,1.82,2.34,6.86,3.05,10.66,1.46h0Z"></path><path d="m6.33,103.4c-4.39-1.99-6.91-6.04-6.21-9.9.23-1.11,2.23-4.8,4.51-8.32,7.21-11.19,17.64-31.23,18.98-36.56l.35-1.46h-8.67c-7.62,0-8.91-.18-10.66-1.17-2.99-1.76-4.34-3.93-4.34-6.91,0-3.52,1.64-6.04,5.1-7.73,2.81-1.41,3.4-1.46,13.89-1.46h10.96l.64-3.93c.35-2.23,1.05-6.86,1.58-10.43,1-7.21,1.93-9.79,4.22-12.19,2.34-2.46,4.39-3.34,7.85-3.34,5.74,0,9.26,3.34,9.26,8.79,0,1.46-.64,5.8-1.46,9.67-.76,3.87-1.46,7.27-1.46,7.56,0,.94,2.99-.29,7.97-3.28,6.04-3.57,9.32-4.22,12.42-2.23,4.51,2.81,4.92,10.84.82,16.35-2.7,3.63-10.9,6.33-20.92,6.91l-6.45.35-1.99,5.33c-3.63,9.67-9.43,22.73-15.35,34.34-6.74,13.3-9.43,17.64-11.72,18.98-2.46,1.46-6.86,1.76-9.32.64h0Z"></path><path d="m109.17,57.17c-11.19-4.69-29.82-13.3-30.88-14.24-4.69-4.22-3.46-12.42,2.17-15.12,4.28-1.99,6.56-1.29,24.9,7.73,15.12,7.38,16.88,8.44,18.34,10.61,1.99,2.87,2.34,6.8.76,9.2-1.29,1.99-5.21,3.81-8.26,3.81-1.35,0-4.34-.88-7.03-1.99Z"></path></svg>`;

let portal: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
let controlsContainer: HTMLDivElement | null = null;
let activeRenderer: LyricsRenderer | null = null;
let isLoading = false;


function renderLyrics(lyrics: TransformedLyrics | null): void {
  if (!content) return;

  const lyricsEl = content.querySelector<HTMLElement>(".VL-FS-Lyrics");
  if (!lyricsEl) return;

  if (activeRenderer) {
    activeRenderer.destroy();
    activeRenderer = null;
  }
  lyricsEl.innerHTML = "";

  if (!lyrics) {
    if (isLoading) {
      const skeleton = document.createElement("div");
      skeleton.className = "VL-Skeleton";
      for (let i = 0; i < 20; i++) {
        const line = document.createElement("div");
        line.className = "VL-SkeletonLine";
        skeleton.appendChild(line);
      }
      lyricsEl.appendChild(skeleton);
    } else {
      lyricsEl.innerHTML = `<div class="VL-NoLyrics">${getNoLyricsMessage()}</div>`;
    }
    return;
  }

  isLoading = false;

  if (lyrics.type === "Static") {
    lyricsEl.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    const showRomanized = getRomanize();
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = showRomanized ? (line.romanizedText ?? line.text) : line.text;
      p.className = "VL-FS-Line";
      lyricsEl.appendChild(p);
    }
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VL-FS-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      lyricsEl.appendChild(credits);
    }
    return;
  }

  activeRenderer = new LyricsRenderer(lyricsEl, lyrics);

  if (lyrics.songWriters?.length) {
    const credits = document.createElement("div");
    credits.className = "VL-FS-Credits";
    credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
    lyricsEl.appendChild(credits);
  }
}

function handleClose(): void {
  setPageMode("page");
}

function onKeyDown(e: KeyboardEvent): void {
  const mode = getPageMode();
  if (mode === "page") return;

  if (e.key === "Escape") {
    e.preventDefault();
    if (mode === "fullscreen") {
      setPageMode("cinema");
    } else {
      setPageMode("page");
    }
  }
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    if (mode === "cinema") {
      setPageMode("fullscreen");
    } else if (mode === "fullscreen") {
      setPageMode("cinema");
    }
  }
}

function onFullscreenChange(): void {
  if (!document.fullscreenElement && getPageMode() === "fullscreen") {
    setPageMode("cinema");
  }
}

function updateControls(): void {
  if (!controlsContainer) return;
  const mode = getPageMode();
  const pos = get("controlsPosition");
  controlsContainer.innerHTML = "";
  controlsContainer.classList.toggle("VL-FS-Controls-Bottom", pos === "bottom");
  controlsContainer.classList.toggle("VL-FS-Controls-Top", pos !== "bottom");

  if (hasRomanizeCapability() && get("romanization")) {
    const romanizeBtn = document.createElement("button");
    romanizeBtn.className = "VL-FS-ControlBtn";
    romanizeBtn.title = getRomanize() ? "Show Original Text" : "Show Romanized Text";
    romanizeBtn.innerHTML = getRomanize() ? RomanizeOffIcon : RomanizeOnIcon;
    romanizeBtn.addEventListener("click", () => toggleRomanize());
    controlsContainer.appendChild(romanizeBtn);
  }

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.className = "VL-FS-ControlBtn";
  fullscreenBtn.title = mode === "fullscreen" ? "Cinema Mode" : "Fullscreen";
  fullscreenBtn.innerHTML = mode === "fullscreen" ? CloseFullscreenIcon : FullscreenIcon;
  fullscreenBtn.addEventListener("click", () => {
    setPageMode(mode === "fullscreen" ? "cinema" : "fullscreen");
  });
  controlsContainer.appendChild(fullscreenBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "VL-FS-ControlBtn";
  closeBtn.title = "Close";
  closeBtn.innerHTML = CloseIcon;
  closeBtn.addEventListener("click", handleClose);
  controlsContainer.appendChild(closeBtn);
}

function show(): void {
  if (!portal) return;
  portal.style.display = "block";
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  isLoading = isLyricsLoading();
  updateControls();
  renderLyrics(getLyrics());
}

function hide(): void {
  if (!portal) return;
  portal.style.display = "none";
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("fullscreenchange", onFullscreenChange);

  // Destroy renderer to stop RAF loop and free GPU memory
  if (activeRenderer) {
    activeRenderer.destroy();
    activeRenderer = null;
  }
}

function enterBrowserFullscreen(): void {
  document.documentElement.requestFullscreen().catch(() => {
    setPageMode("cinema");
  });
}

function exitBrowserFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function setupModeReaction(): void {
  onPageModeChange((mode) => {
    if (mode === "page") {
      hide();
      exitBrowserFullscreen();
    } else if (mode === "cinema") {
      show();
      exitBrowserFullscreen();
    } else if (mode === "fullscreen") {
      show();
      enterBrowserFullscreen();
    }
  });
}

export function setupFullscreen(): void {
  portal = document.createElement("div");
  portal.className = "VividLyrics-FullscreenPortal";
  portal.style.display = "none";

  content = document.createElement("div");
  content.className = "VividLyrics-FullscreenContent";

  controlsContainer = document.createElement("div");
  controlsContainer.className = "VL-FS-Controls";

  const lyricsDiv = document.createElement("div");
  lyricsDiv.className = "VL-FS-Lyrics";

  content.appendChild(controlsContainer);
  content.appendChild(lyricsDiv);
  portal.appendChild(content);
  document.body.appendChild(portal);

  setupModeReaction();
  onLyricsChange((lyrics) => {
    if (getPageMode() !== "page") {
      isLoading = isLyricsLoading();
      if (lyrics) {
        const canRomanize = !!(lyrics.romanizedLanguage && lyrics.romanizedLanguage !== "Latin");
        resetRomanize(canRomanize);
      }
      renderLyrics(lyrics);
    }
  });
  onRomanizeChange(() => {
    if (getPageMode() !== "page") {
      updateControls();
      isLoading = isLyricsLoading();
      renderLyrics(getLyrics());
    }
  });
  onSettingsChange(({ key }) => {
    if (getPageMode() === "page") return;
    if (
      key !== null &&
      key !== "fontSize" &&
      key !== "fontFamily" &&
      key !== "gradientDirection" &&
      key !== "controlsPosition" &&
      key !== "animationStyle" &&
      key !== "romanization" &&
      key !== "stripBackgroundBrackets"
    ) {
      return;
    }
    updateControls();
    isLoading = isLyricsLoading();
    renderLyrics(getLyrics());
  });
}
