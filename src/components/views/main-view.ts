import type { TransformedLyrics } from "../../lyrics/types";
import { loadLyrics, getLyrics, onLyricsChange, isLyricsLoading } from "../../stores/lyrics";
import { setPageMode } from "../../stores/page";
import { get, onSettingsChange } from "../../stores/settings";
import { getNoLyricsMessage } from "../shared/no-lyrics";
import { setLyricsVisibility } from "./card-view";
import LyricsRenderer from "../../renderer/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../../stores/romanize";
import SimpleBar from "simplebar";
import "simplebar/dist/simplebar.css";

import {
  CinemaIcon,
  ShrinkIcon,
  RomanizeOnIcon,
  RomanizeOffIcon,
} from "../shared/svg-icons";
import { createFluidMeshBackground } from "../fluid-mesh-bg";
import { createPlayerWidget, type PlayerWidget } from "../player-widget";

const BASE_ROUTE = "/vivid-lyrics";

let pageContainer: HTMLDivElement | null = null;
let hiddenSiblings: HTMLElement[] = [];
let isOpen = false;
let isLoading = false;

let lyricsUnsub: (() => void) | null = null;
let romanizeUnsub: (() => void) | null = null;
let settingsUnsub: (() => void) | null = null;
let activeRenderer: LyricsRenderer | null = null;
let romanizeBtn: HTMLButtonElement | null = null;
let playerWidget: PlayerWidget | null = null;

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

let mainControls: HTMLElement | null = null;

function updateMainControlsPosition(): void {
  if (!mainControls) return;
  const pos = get("controlsPosition") || "bottom";
  mainControls.classList.toggle("VL-MainControls-Bottom", pos === "bottom");
  mainControls.classList.toggle("VL-MainControls-Top", pos !== "bottom");
}

function updateMainRomanizeBtn(): void {
  if (!romanizeBtn) return;
  const show = getRomanize();
  const iconEl = romanizeBtn.querySelector<HTMLElement>(".icon");
  const textEl = romanizeBtn.querySelector<HTMLElement>(".btn-text");
  if (iconEl) {
    iconEl.innerHTML = show ? RomanizeOffIcon : RomanizeOnIcon;
  }
  if (textEl) {
    textEl.textContent = show ? "Show Original" : "Show Romanized";
  }
  romanizeBtn.classList.toggle("romanize-active", show);
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

  const stage = document.createElement("div");
  stage.className = "VL-MainStage";

  const playerHost = document.createElement("div");
  playerHost.className = "VL-PlayerWidgetHost VL-MainPlayerHost";
  playerWidget = createPlayerWidget("main");
  playerHost.appendChild(playerWidget.element);

  stage.appendChild(playerHost);
  stage.appendChild(content);

  const controls = document.createElement("div");
  controls.className = "VL-MainControls";
  mainControls = controls;
  updateMainControlsPosition();

  romanizeBtn = document.createElement("button");
  romanizeBtn.className = "VL-MainControlBtn romanize-btn";
  romanizeBtn.innerHTML = `<span class="icon">${RomanizeOnIcon}</span><span class="btn-text">Show Romanized</span>`;
  romanizeBtn.addEventListener("click", () => toggleRomanize());
  controls.appendChild(romanizeBtn);
  updateMainRomanizeBtn();

  const cinemaBtn = document.createElement("button");
  cinemaBtn.className = "VL-MainControlBtn cinema-btn";
  cinemaBtn.innerHTML = `<span class="icon">${CinemaIcon}</span><span class="btn-text">Cinema Mode</span>`;
  cinemaBtn.addEventListener("click", () => setPageMode("cinema"));
  controls.appendChild(cinemaBtn);

  const shrinkBtn = document.createElement("button");
  shrinkBtn.className = "VL-MainControlBtn shrink-btn";
  shrinkBtn.innerHTML = `<span class="icon">${ShrinkIcon}</span><span class="btn-text">Now Playing</span>`;
  shrinkBtn.addEventListener("click", () => {
    (Spicetify.Platform.History as any).goBack();
    setTimeout(() => setLyricsVisibility(true), 100);
  });
  controls.appendChild(shrinkBtn);

  pageContainer.appendChild(createFluidMeshBackground());
  pageContainer.appendChild(stage);
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
      key !== "controlsPosition" &&
      key !== "scrollMode" &&
      key !== "animationStyle" &&
      key !== "romanization" &&
      key !== "stripBackgroundBrackets"
    ) {
      return;
    }
    updateMainControlsPosition();
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
  playerWidget?.destroy();
  playerWidget = null;

  pageContainer?.remove();
  pageContainer = null;
  mainControls = null;
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
