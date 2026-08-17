import { setPageMode, getPageMode, onPageModeChange } from "../../stores/page";
import { getLyrics, onLyricsChange, isLyricsLoading } from "../../stores/lyrics";
import { get, onSettingsChange } from "../../stores/settings";
import type { TransformedLyrics } from "../../lyrics/types";
import { getNoLyricsMessage } from "../shared/no-lyrics";
import LyricsRenderer from "../../renderer/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../../stores/romanize";
import {
  FullscreenIcon,
  CloseFullscreenIcon,
  CloseIcon,
  RomanizeOnIcon,
  RomanizeOffIcon,
} from "../shared/svg-icons";
import "../../styles/fullscreen.scss";

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
    activeRenderer.appendCredits(credits);
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
    const show = getRomanize();
    const romanizeBtn = document.createElement("button");
    romanizeBtn.className = `VL-FS-ControlBtn romanize-btn${show ? " romanize-active" : ""}`;
    romanizeBtn.innerHTML = `<span class="icon">${show ? RomanizeOffIcon : RomanizeOnIcon}</span><span class="btn-text">${show ? "Show Original" : "Show Romanized"}</span>`;
    romanizeBtn.addEventListener("click", () => toggleRomanize());
    controlsContainer.appendChild(romanizeBtn);
  }

  const isFs = mode === "fullscreen";
  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.className = `VL-FS-ControlBtn fullscreen-btn${isFs ? " is-fullscreen" : ""}`;
  fullscreenBtn.innerHTML = `<span class="icon">${isFs ? CloseFullscreenIcon : FullscreenIcon}</span><span class="btn-text">${isFs ? "Cinema Mode" : "Fullscreen"}</span>`;
  fullscreenBtn.addEventListener("click", () => {
    setPageMode(isFs ? "cinema" : "fullscreen");
  });
  controlsContainer.appendChild(fullscreenBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "VL-FS-ControlBtn close-btn";
  closeBtn.innerHTML = `<span class="icon">${CloseIcon}</span><span class="btn-text">Close</span>`;
  closeBtn.addEventListener("click", handleClose);
  controlsContainer.appendChild(closeBtn);
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let isHoveringControls = false;

function resetIdleTimer(): void {
  if (!content) return;
  content.classList.remove("vl-idle");
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (getPageMode() === "page" || isHoveringControls) return;

  idleTimer = setTimeout(() => {
    if (getPageMode() !== "page" && !isHoveringControls) {
      content?.classList.add("vl-idle");
    }
  }, 3000);
}

function show(): void {
  if (!portal) return;
  portal.style.display = "block";
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keydown", resetIdleTimer);
  document.addEventListener("mousemove", resetIdleTimer);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  isLoading = isLyricsLoading();
  updateControls();
  resetIdleTimer();
  renderLyrics(getLyrics());
}

function hide(): void {
  if (!portal) return;
  portal.style.display = "none";
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("keydown", resetIdleTimer);
  document.removeEventListener("mousemove", resetIdleTimer);
  document.removeEventListener("fullscreenchange", onFullscreenChange);

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  content?.classList.remove("vl-idle");

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
  controlsContainer.addEventListener("mouseenter", () => {
    isHoveringControls = true;
    resetIdleTimer();
  });
  controlsContainer.addEventListener("mouseleave", () => {
    isHoveringControls = false;
    resetIdleTimer();
  });

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
