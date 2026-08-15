import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, onLyricsChange, isLyricsLoading } from "../stores/lyrics";
import { get, onSettingsChange } from "../stores/settings";
import storage from "../utils/storage";
import { getNoLyricsMessage, resetNoLyricsMessage } from "../utils/no-lyrics-messages";
import LyricsRenderer from "../modules/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../stores/romanize";
import "../styles/lyrics.scss";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

const CloseIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>`;
const LyricsIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1h-11A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1Zm-7 11H4V9h2.5v3Zm4 0H8V5h2.5v7Zm2.5 0h-2.5V7H16v5a1 1 0 0 1-1 1Z"/></svg>`;
const ExpandIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13,13H5V9H3v6h12V3H9v2h4V13z M2,8V3.413l6.294,6.294l1.413-1.413L3.412,2H8V0L0,0l0,8H2z"></path></svg>`;
const RomanizeOnIcon = `<svg role="img" height="20" width="20" aria-hidden="true" viewBox="0 0 750 900" fill="currentColor"><path d="m529.42,632.32H214.71l-81.89,163.5H13.31L377.06,80.35l350.9,715.47h-121.41l-77.13-163.5Zm-45.23-95.48l-109.03-228.9-114.27,228.9h223.3Z"></path></svg>`;
const RomanizeOffIcon = `<svg role="img" height="17" width="17" aria-hidden="true" viewBox="0 0 125.45 131.07" fill="currentColor"><path d="m53.38,130.41c-12.54-2.87-20.86-14.36-19.98-27.42.59-7.62,5.8-15.12,13.07-18.69,4.28-2.11,11.02-3.4,17.75-3.46h4.8v-12.71c.06-16,.64-17.99,5.98-20.74,4.86-2.46,10.96-.47,13.3,4.34,1.17,2.34,1.23,3.52,1.23,17.23v14.65l2.81,1.05c13.59,5.1,30.59,17.87,32.34,24.38,1.17,4.34-.88,8.79-4.92,10.72-4.1,1.93-5.63,1.41-13.89-5.27-4.69-3.69-12.83-9.02-15.29-9.96-.88-.29-1.05,0-1.05,1.64,0,2.93-1.58,8.5-3.34,11.78-1.93,3.46-6.74,8.03-10.43,9.79-6.21,2.99-15.88,4.16-22.38,2.7v-.03Zm11.84-20.51c1.05-.47,2.4-1.46,2.87-2.29,1-1.52,1.41-5.39.7-6.15-.64-.59-12.66-.18-13.95.53-1.23.64-1.46,4.92-.29,6.45,1.82,2.34,6.86,3.05,10.66,1.46h0Z"></path><path d="m6.33,103.4c-4.39-1.99-6.91-6.04-6.21-9.9.23-1.11,2.23-4.8,4.51-8.32,7.21-11.19,17.64-31.23,18.98-36.56l.35-1.46h-8.67c-7.62,0-8.91-.18-10.66-1.17-2.99-1.76-4.34-3.93-4.34-6.91,0-3.52,1.64-6.04,5.1-7.73,2.81-1.41,3.4-1.46,13.89-1.46h10.96l.64-3.93c.35-2.23,1.05-6.86,1.58-10.43,1-7.21,1.93-9.79,4.22-12.19,2.34-2.46,4.39-3.34,7.85-3.34,5.74,0,9.26,3.34,9.26,8.79,0,1.46-.64,5.8-1.46,9.67-.76,3.87-1.46,7.27-1.46,7.56,0,.94,2.99-.29,7.97-3.28,6.04-3.57,9.32-4.22,12.42-2.23,4.51,2.81,4.92,10.84.82,16.35-2.7,3.63-10.9,6.33-20.92,6.91l-6.45.35-1.99,5.33c-3.63,9.67-9.43,22.73-15.35,34.34-6.74,13.3-9.43,17.64-11.72,18.98-2.46,1.46-6.86,1.76-9.32.64h0Z"></path><path d="m109.17,57.17c-11.19-4.69-29.82-13.3-30.88-14.24-4.69-4.22-3.46-12.42,2.17-15.12,4.28-1.99,6.56-1.29,24.9,7.73,15.12,7.38,16.88,8.44,18.34,10.61,1.99,2.87,2.34,6.8.76,9.2-1.29,1.99-5.21,3.81-8.26,3.81-1.35,0-4.34-.88-7.03-1.99Z"></path></svg>`;

let card: HTMLDivElement | null = null;
let header: HTMLDivElement | null = null;
let title: HTMLDivElement | null = null;
let showBtn: HTMLButtonElement | null = null;
let expandBtn: HTMLButtonElement | null = null;
let closeBtn: HTMLButtonElement | null = null;
let romanizeBtn: HTMLButtonElement | null = null;
let body: HTMLDivElement | null = null;
let headerActions: HTMLDivElement | null = null;
let renderer: LyricsRenderer | null = null;
let currentLyrics: TransformedLyrics | null = null;
let mountedLyrics: TransformedLyrics | null = null;
let swapTimer: ReturnType<typeof setTimeout> | undefined;
let syncingLyricsUpdate = false;

function getVisible(): boolean {
  return storage.get("CardLyricsVisible") !== "false";
}

function setVisible(visible: boolean): void {
  storage.set("CardLyricsVisible", String(visible));
}

function getTrackUri(): string | null {
  return Spicetify.Player.data?.item?.uri ?? null;
}

function ensureCard(): void {
  if (card) {
    card.style.setProperty("--vl-card-height", `${get("cardHeight")}px`);
    return;
  }

  card = document.createElement("div");
  card.id = "VividLyrics-Card";
  card.style.setProperty("--vl-card-height", `${get("cardHeight")}px`);

  header = document.createElement("div");
  header.className = "VL-CardHeader";

  title = document.createElement("div");
  title.className = "VL-CardTitle";
  title.textContent = "Lyrics";
  header.appendChild(title);

  showBtn = document.createElement("button");
  showBtn.className = "VL-ShowBtn";
  showBtn.textContent = "Show lyrics";
  showBtn.addEventListener("click", () => setLyricsVisibility(true));
  header.appendChild(showBtn);

  expandBtn = document.createElement("button");
  expandBtn.className = "action-btn expand-btn";
  expandBtn.innerHTML = `<span class="icon">${ExpandIcon}</span><span class="btn-text">Open Lyrics Page</span>`;
  expandBtn.addEventListener("click", () => {
    setLyricsVisibility(false);
    (Spicetify.Platform.History as any).push({ pathname: "/vivid-lyrics" });
  });

  romanizeBtn = document.createElement("button");
  romanizeBtn.className = "action-btn romanize-btn";
  romanizeBtn.innerHTML = `<span class="icon">${RomanizeOnIcon}</span><span class="btn-text">Show Romanized</span>`;
  romanizeBtn.addEventListener("click", () => toggleRomanize());

  closeBtn = document.createElement("button");
  closeBtn.className = "action-btn close-btn";
  closeBtn.innerHTML = `<span class="icon">${CloseIcon}</span><span class="btn-text">Close</span>`;
  closeBtn.addEventListener("click", () => setLyricsVisibility(false));

  headerActions = document.createElement("div");
  headerActions.className = "VL-HeaderActions";

  card.appendChild(header);

  if (get("centeredTextCard")) {
    card.classList.add("vl-card-centered");
  }

  body = document.createElement("div");
  body.className = "VL-LyricsBody";
  body.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
  card.appendChild(body);
}

function destroyRenderer(): void {
  renderer?.destroy();
  renderer = null;
}

function updateRomanizeBtn(): void {
  if (!romanizeBtn || !headerActions) return;
  const show = getRomanize();

  const iconEl = romanizeBtn.querySelector<HTMLElement>(".icon");
  const textEl = romanizeBtn.querySelector<HTMLElement>(".btn-text");

  if (iconEl) {
    iconEl.innerHTML = show ? RomanizeOffIcon : RomanizeOnIcon;
  }

  if (textEl) {
    const newText = show ? "Show Original" : "Show Romanized";
    if (textEl.textContent !== newText) {
      clearTimeout(swapTimer);
      textEl.style.opacity = "0";
      swapTimer = setTimeout(() => {
        textEl.textContent = newText;
        requestAnimationFrame(() => {
          textEl.style.opacity = "1";
        });
        swapTimer = setTimeout(() => {
          textEl.style.opacity = "";
        }, 160);
      }, 150);
    }
  }

  romanizeBtn.classList.toggle("romanize-active", show);
  const shouldShow = hasRomanizeCapability() && get("romanization");
  if (shouldShow && !romanizeBtn.parentElement) {
    headerActions.insertBefore(romanizeBtn, expandBtn);
  } else if (!shouldShow && romanizeBtn.parentElement) {
    romanizeBtn.remove();
  }
}

function clearBody(): void {
  if (!body) return;
  card?.classList.remove("vl-card-no-lyrics");
  destroyRenderer();
  mountedLyrics = null;
  body.innerHTML = "";
}

function populateBody(lyrics: TransformedLyrics): void {
  if (!body) return;

  if (lyrics.type === "Static") {
    const scroll = document.createElement("div");
    scroll.className = "LyricsScrollContainer VL-StaticLyricsScroll";
    scroll.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    const showRomanized = getRomanize();
    for (const line of lyrics.lines) {
      const lineEl = document.createElement("div");
      lineEl.className = "VL-FS-Line";
      lineEl.textContent = showRomanized ? (line.romanizedText ?? line.text) : line.text;
      scroll.appendChild(lineEl);
    }
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VL-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      scroll.appendChild(credits);
    }
    body.appendChild(scroll);
  } else {
    renderer = new LyricsRenderer(body, lyrics, [0, 1.25, 2.5, 3.75, 5, 6.25], "card", get("cardScrollMode"));
    if (lyrics.songWriters?.length) {
      const credits = document.createElement("div");
      credits.className = "VL-Credits";
      credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
      renderer.appendCredits(credits);
    }
  }

  mountedLyrics = lyrics;
}

export function setLyricsVisibility(visible: boolean): void {
  setVisible(visible);
  reactToVisibility();
}

function reactToVisibility(): void {
  ensureCard();

  const visible = getVisible();

  if (visible) {
    card!.classList.add("vl-card-expanded");
    headerActions!.appendChild(expandBtn!);
    headerActions!.appendChild(closeBtn!);
    header!.appendChild(headerActions!);
    updateRomanizeBtn();
    showBtn!.remove();
    body!.style.display = "";

    if (currentLyrics) {
      clearBody();
      populateBody(currentLyrics);
    } else {
      clearBody();
      const skeleton = document.createElement("div");
      skeleton.className = "VL-Skeleton";
      for (let i = 0; i < 20; i++) {
        const line = document.createElement("div");
        line.className = "VL-SkeletonLine";
        skeleton.appendChild(line);
      }
      body!.appendChild(skeleton);
      const uri = getTrackUri();
      if (uri) loadLyrics(uri).then((lyrics) => {
        if (lyrics && getVisible()) onLyricsUpdate(lyrics);
      });
    }
  } else {
    card!.classList.remove("vl-card-expanded");
    header!.appendChild(showBtn!);
    headerActions!.remove();
    clearBody();
    body!.style.display = "none";
  }

  ensureInDOM();
}

function showNoLyrics(): void {
  ensureCard();
  card!.classList.add("vl-card-expanded");
  headerActions!.appendChild(expandBtn!);
  headerActions!.appendChild(closeBtn!);
  header!.appendChild(headerActions!);
  updateRomanizeBtn();
  showBtn!.remove();
  clearBody();
  card!.classList.add("vl-card-no-lyrics");
  const container = document.createElement("div");
  container.id = "VividLyrics-NoLyrics";
  const noLyrics = document.createElement("p");
  noLyrics.className = "VL-NoLyrics";
  noLyrics.textContent = getNoLyricsMessage();
  container.appendChild(noLyrics);
  body!.appendChild(container);
  ensureInDOM();
}

function ensureInDOM(): void {
  if (!card) return;
  // `card.parentElement` can be non-null while still being detached from the
  // live document (e.g. Spotify swapped out the whole wrapper subtree that
  // used to contain both the anchor and our card). Check against the
  // document itself, not just "has a parent", or we'd wrongly skip
  // re-inserting a card that's floating in a detached tree.
  if (document.body.contains(card)) return;
  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) {
    anchor.after(card);
  }
}

function onLyricsUpdate(lyrics: TransformedLyrics | null) {
  currentLyrics = lyrics;

  syncingLyricsUpdate = true;
  try {
    if (lyrics) {
      const canRomanize = !!(lyrics.romanizedLanguage && lyrics.romanizedLanguage !== "Latin");
      resetRomanize(canRomanize);
    } else if (!isLyricsLoading()) {
      resetRomanize(false);
    }
  } finally {
    syncingLyricsUpdate = false;
  }

  if (!getVisible()) return;

  if (lyrics) {
    clearBody();
    populateBody(lyrics);
  } else if (!isLyricsLoading()) {
    // A null update during loading only means the previous track was cleared.
    // The song-change path has already installed the loading skeleton.
    showNoLyrics();
  }
}

async function onSongChange() {
  const uri = getTrackUri();
  console.log("[VividLyrics] songChange uri:", uri);
  if (!uri) return;
  resetNoLyricsMessage();

  // Always pre-load lyrics so the store has them ready
  const loadPromise = loadLyrics(uri);

  if (!getVisible()) {
    reactToVisibility();
    return;
  }

  ensureCard();
  card!.classList.add("vl-card-expanded");
  headerActions!.appendChild(expandBtn!);
  headerActions!.appendChild(closeBtn!);
  header!.appendChild(headerActions!);
  updateRomanizeBtn();
  showBtn!.remove();
  clearBody();
  const skeleton = document.createElement("div");
  skeleton.className = "VL-Skeleton";
  for (let i = 0; i < 20; i++) {
    const line = document.createElement("div");
    line.className = "VL-SkeletonLine";
    skeleton.appendChild(line);
  }
  body!.appendChild(skeleton);
  ensureInDOM();

  const lyrics = await loadPromise;
  // If loadLyrics returned cached lyrics without emitting, update UI directly
  if (lyrics && getVisible() && mountedLyrics !== lyrics) {
    onLyricsUpdate(lyrics);
  }
}

function suppressNativeLyrics(container: Element) {
  const native = container.querySelector<HTMLDivElement>(NATIVE_LYRICS_QUERY);
  if (native) native.style.display = "none";
}

function observeNPV() {
  let current: Element | null = null;
  let nativeObserver: MutationObserver | null = null;

  // Cheap path: the anchor node's *identity* changed (Spotify swapped the
  // wrapper it lives in, e.g. while navigating Home/Playlists/Artists with
  // the main view closed) but the sidebar itself is still around. We just
  // need to re-point the native-lyrics suppressor at the new subtree and
  // make sure our card is still physically in the document — we do NOT
  // tear down the renderer, buttons, or listeners. This is what used to
  // cause the hover-lag/rebuild-thrash bug: a full destroy+rebuild was
  // firing on every such swap, up to once a second while browsing.
  const reattach = (el: Element) => {
    current = el;
    suppressNativeLyrics(el.parentElement!);
    nativeObserver?.disconnect();
    nativeObserver = new MutationObserver(() => suppressNativeLyrics(el.parentElement!));
    nativeObserver.observe(el.parentElement!, { childList: true });
    ensureInDOM();
  };

  // Expensive path: the NPV sidebar itself is genuinely gone (e.g. the user
  // closed the whole Now Playing panel). Only here do we actually tear
  // everything down.
  const teardown = () => {
    clearTimeout(swapTimer);
    nativeObserver?.disconnect();
    nativeObserver = null;
    destroyRenderer();
    mountedLyrics = null;
    card?.remove();
    card = null;
    header = null;
    title = null;
    showBtn = null;
    expandBtn = null;
    closeBtn = null;
    romanizeBtn = null;
    headerActions = null;
    body = null;
    current = null;
  };

  const runCheck = () => {
    const el = document.querySelector(`${ANCHOR}, ${ANCHOR_FALLBACK}`);
    if (el && el !== current) {
      const firstMount = current === null;
      reattach(el);
      if (firstMount) {
        onSongChange();
        if (!getTrackUri()) {
          setTimeout(() => {
            if (!getTrackUri()) return;
            onSongChange();
          }, 1000);
        }
      }
    } else if (!el && current) {
      teardown();
    }
  };

  // These listeners are all business-logic, not DOM-anchor-dependent, so
  // they're bound exactly once for the lifetime of the extension instead of
  // being torn down and rebuilt on every anchor swap.
  Spicetify.Player.addEventListener("songchange", () => onSongChange());

  onLyricsChange((lyrics) => onLyricsUpdate(lyrics));

  onRomanizeChange(() => {
    updateRomanizeBtn();
    // resetRomanize() runs synchronously inside onLyricsUpdate(). That
    // update already rebuilds the body below, so rebuilding here as well
    // creates a second full renderer (especially expensive for CJK text).
    if (!syncingLyricsUpdate && currentLyrics && getVisible()) {
      clearBody();
      populateBody(currentLyrics);
    }
  });

  onSettingsChange(({ key }) => {
    if (!getVisible()) return;
    if (
      key !== null &&
      key !== "fontSize" &&
      key !== "fontFamily" &&
      key !== "cardHeight" &&
      key !== "cardScrollMode" &&
      key !== "centeredTextCard" &&
      key !== "animationStyle" &&
      key !== "romanization"
    ) {
      return;
    }
    ensureCard();
    card!.style.setProperty("--vl-card-height", `${get("cardHeight")}px`);
    card!.classList.toggle("vl-card-centered", get("centeredTextCard"));
    body?.style.setProperty("--vl-font-size", String(get("fontSize") / 100));
    updateRomanizeBtn();
    if (currentLyrics) {
      clearBody();
      populateBody(currentLyrics);
    }
  });

  runCheck();
  setInterval(runCheck, 1000);
}

export function setupCardView() {
  observeNPV();
}
