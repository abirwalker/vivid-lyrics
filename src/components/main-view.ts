import { getLyrics } from "../stores/lyrics";
import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange } from "../stores/lyrics";
import { setPageMode } from "../stores/page";

const BASE_ROUTE = "/vivid-lyrics";
let pageContainer: HTMLDivElement | null = null;
let isOpen = false;

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
  content.innerHTML = "";

  if (!lyrics) {
    content.innerHTML = `<div style="padding:32px;text-align:center;opacity:0.5;">No lyrics available</div>`;
    return;
  }

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
      p.style.cssText = "padding:4px 0;opacity:0.7;";
      content.appendChild(p);
    }
  } else {
    const items = "content" in lyrics ? (lyrics as any).content : [];
    for (const item of items) {
      if (item.Type === "Interlude") continue;
      const text = item.Text ?? item.Lead?.Syllables?.map((s: any) => s.Text).join("") ?? "";
      if (!text) continue;

      const p = document.createElement("div");
      p.textContent = text;
      p.style.cssText = "padding:4px 0;opacity:0.7;";
      p.dataset.startTime = String(item.StartTime ?? item.Lead?.StartTime ?? 0);
      p.style.cursor = "pointer";
      p.addEventListener("click", () => {
        const t = parseFloat(p.dataset.startTime ?? "0");
        Spicetify.Player.seek(t * 1000);
      });
      content.appendChild(p);
    }
  }

  if (lyrics.songWriters?.length) {
    const credits = document.createElement("div");
    credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
    credits.style.cssText = "margin-top:24px;font-size:12px;opacity:0.4;";
    content.appendChild(credits);
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
    <style>
      #VividLyrics-MainPage {
        padding: 24px;
        min-height: 100vh;
      }
      #VividLyrics-MainPage .VividLyrics-PageTitle {
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 16px;
      }
      #VividLyrics-MainPage .VividLyrics-PageContent {
        line-height: 1.8;
      }
      #VividLyrics-MainPage .VividLyrics-Toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }
      #VividLyrics-MainPage .VividLyrics-Toolbar button {
        background: var(--spice-button, rgba(255,255,255,0.1));
        border: none;
        color: var(--text-base);
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      #VividLyrics-MainPage .VividLyrics-Toolbar button:hover {
        background: var(--spice-button-pressed, rgba(255,255,255,0.2));
      }
    </style>
    <div class="VividLyrics-PageTitle">Lyrics</div>
    ${renderToolbar()}
    <div class="VividLyrics-PageContent">Loading...</div>
  `;

  pageRoot.appendChild(pageContainer);

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
}

function closePage(): void {
  if (!isOpen) return;
  isOpen = false;

  pageContainer?.remove();
  pageContainer = null;
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
