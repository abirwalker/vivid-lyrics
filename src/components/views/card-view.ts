import type { TransformedLyrics } from "../../lyrics/types";
import { loadLyrics, onLyricsChange, isLyricsLoading } from "../../stores/lyrics";
import { get, onSettingsChange } from "../../stores/settings";
import storage from "../../utils/storage";
import { getNoLyricsMessage, resetNoLyricsMessage } from "../shared/no-lyrics";
import LyricsRenderer from "../../renderer/lyrics-renderer";
import {
  getRomanize,
  hasRomanizeCapability,
  toggleRomanize,
  resetRomanize,
  onRomanizeChange,
} from "../../stores/romanize";
import {
  CloseIcon,
  ExpandIcon,
  RomanizeOnIcon,
  RomanizeOffIcon,
} from "../shared/svg-icons";
import { createFluidMeshBackground } from "../fluid-mesh-bg";
import "../../styles/lyrics.scss";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

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
  let npvBg: HTMLDivElement | null = null;

  const getNowPlayingAside = (): HTMLElement | null => {
    return (
      document.querySelector<HTMLElement>(".Root__right-sidebar aside.NowPlayingView") ??
      document.querySelector<HTMLElement>(".Root__right-sidebar aside#Desktop_PanelContainer_Id:has(.main-nowPlayingView-coverArtContainer)") ??
      document.querySelector<HTMLElement>(".Root__right-sidebar aside:has(.main-nowPlayingView-coverArtContainer)") ??
      document.querySelector<HTMLElement>(".Root__right-sidebar aside")
    );
  };

  function syncNPVBackground(): void {
    const aside = getNowPlayingAside();
    if (!aside) return;

    const enabled = get("npvAmbiance") && get("backgroundMode") !== "none";

    if (enabled) {
      if (!npvBg || !aside.contains(npvBg)) {
        npvBg?.remove();
        npvBg = createFluidMeshBackground();
        aside.classList.add("VL-NPV-Active");
        aside.prepend(npvBg);
      }
    } else {
      npvBg?.remove();
      npvBg = null;
      aside.classList.remove("VL-NPV-Active");
      aside.querySelectorAll(".VL-FluidMeshBg").forEach((el) => el.remove());
    }
  }

  const reattach = (el: Element) => {
    current = el;
    suppressNativeLyrics(el.parentElement!);
    nativeObserver?.disconnect();
    nativeObserver = new MutationObserver(() => suppressNativeLyrics(el.parentElement!));
    nativeObserver.observe(el.parentElement!, { childList: true });

    syncNPVBackground();
    ensureInDOM();
  };

  // Expensive path: the NPV sidebar itself is genuinely gone (e.g. the user
  // closed the whole Now Playing panel). Only here do we actually tear
  // everything down.
  const teardown = () => {
    clearTimeout(swapTimer);
    nativeObserver?.disconnect();
    nativeObserver = null;
    npvBg?.remove();
    npvBg = null;
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
    if (key === "npvAmbiance" || key === "backgroundMode" || key === null) {
      syncNPVBackground();
    }

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
