import { setPageMode, getPageMode, onPageModeChange } from "../stores/page";
import { getLyrics, onLyricsChange } from "../stores/lyrics";
import { get } from "../stores/settings";
import type { TransformedLyrics } from "../lyrics/types";
import { whyamidoingthis, getNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";
import "../styles/fullscreen.scss";

let portal: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
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
    lyricsEl.innerHTML = `<div class="VL-StatusText" style="text-align:center;">${getNoLyricsMessage()}</div>`;
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

function show(): void {
  if (!portal) return;
  portal.style.display = "block";
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  renderLyrics(getLyrics());
}

function hide(): void {
  if (!portal) return;
  portal.style.display = "none";
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
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

  const closeBtn = document.createElement("button");
  closeBtn.className = "VL-FS-CloseBtn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", handleClose);

  const lyricsDiv = document.createElement("div");
  lyricsDiv.className = "VL-FS-Lyrics";

  content.appendChild(closeBtn);
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
