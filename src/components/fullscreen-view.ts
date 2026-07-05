import { setPageMode, getPageMode, onPageModeChange } from "../stores/page";
import { getLyrics, onLyricsChange } from "../stores/lyrics";
import { get } from "../stores/settings";
import type { TransformedLyrics } from "../lyrics/types";
import { whyamidoingthis, getNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";
import "../styles/fullscreen.scss";

const CinemaIcon = `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M18.6,26.6,8,37.2V30.1A2.1,2.1,0,0,0,6.3,28,2,2,0,0,0,4,30V42a2,2,0,0,0,2,2H17.9A2.1,2.1,0,0,0,20,42.3,2,2,0,0,0,18,40H10.8L21.3,29.5a2.1,2.1,0,0,0,.3-2.7A1.9,1.9,0,0,0,18.6,26.6Z"/><path d="M30,4a2,2,0,0,0-2,2.3A2.1,2.1,0,0,0,30.1,8h7.1L26.7,18.5a2,2,0,0,0-.2,2.8A1.8,1.8,0,0,0,28,22a2,2,0,0,0,1.4-.6L40,10.8v7.1A2.1,2.1,0,0,0,41.7,20,2,2,0,0,0,44,18V6a2,2,0,0,0-2-2Z"/></svg>`;
const FullscreenIcon = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M30 6H42V18"/><path d="M18 6H6V18"/><path d="M30 42H42V30"/><path d="M18 42H6V30"/><path d="M42 6L29 19"/><path d="M19 29L6 42"/></svg>`;
const CloseFullscreenIcon = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M41 19H29V7"/><path d="M18 6H6V18"/><path d="M30 42H42V30"/><path d="M7 29H19V41"/><path d="M42 6L29 19"/><path d="M19 29L6 42"/></svg>`;
const CloseIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

let portal: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
let controlsContainer: HTMLDivElement | null = null;
let activeRenderer: LyricsRenderer | null = null;

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
    lyricsEl.innerHTML = `<div class="VL-NoLyrics">${getNoLyricsMessage()}</div>`;
    return;
  }

  if (lyrics.type === "Static") {
    lyricsEl.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
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
      renderLyrics(lyrics);
    }
  });
}
