import type { TransformedLyrics } from "../lyrics/types";
import { loadLyrics, getLyrics, onLyricsChange } from "../stores/lyrics";

const ANCHOR = ".main-nowPlayingView-nowPlayingWidget";
const ANCHOR_FALLBACK = ".main-nowPlayingView-coverArtContainer";
const NATIVE_LYRICS_QUERY =
  ".main-nowPlayingView-section:not(:is(#VividLyrics-Card)):has(.main-nowPlayingView-lyricsTitle)";

let card: HTMLDivElement | null = null;

function getTrackUri(): string | null {
  return Spicetify.Player.data?.item?.uri ?? null;
}

function renderCard(lyrics: TransformedLyrics): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "VividLyrics-Card";
  el.style.cssText = "padding:16px;color:var(--text-base);font-size:14px;line-height:1.8;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";

  const title = document.createElement("div");
  title.textContent = "Lyrics";
  title.style.cssText = "font-weight:700;font-size:16px;";
  header.appendChild(title);

  const viewBtn = document.createElement("button");
  viewBtn.textContent = "View Full";
  viewBtn.style.cssText = "background:var(--spice-button,rgba(255,255,255,0.1));border:none;color:var(--text-base);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;";
  viewBtn.addEventListener("click", () => {
    (Spicetify.Platform.History as any).push({ pathname: "/vivid-lyrics" });
  });
  header.appendChild(viewBtn);
  el.appendChild(header);

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      const p = document.createElement("div");
      p.textContent = line.text;
      p.style.cssText = "opacity:0.7;";
      el.appendChild(p);
    }
  } else {
    const content = "content" in lyrics ? (lyrics as any).content : [];
    for (const item of content) {
      if (item.Type === "Interlude") continue;
      const text = item.Text ?? item.Lead?.Syllables?.map((s: any) => s.Text).join("") ?? "";
      if (!text) continue;

      const p = document.createElement("div");
      p.textContent = text;
      p.style.cssText = "opacity:0.7;";
      p.dataset.startTime = String(item.StartTime ?? item.Lead?.StartTime ?? 0);
      p.style.cursor = "pointer";
      p.addEventListener("click", () => {
        const t = parseFloat(p.dataset.startTime ?? "0");
        Spicetify.Player.seek(t * 1000);
      });
      el.appendChild(p);
    }
  }

  if (lyrics.songWriters?.length) {
    const credits = document.createElement("div");
    credits.textContent = `Written by: ${lyrics.songWriters.join(", ")}`;
    credits.style.cssText = "margin-top:16px;font-size:12px;opacity:0.4;";
    el.appendChild(credits);
  }

  return el;
}

function mountCard(lyrics: TransformedLyrics | null) {
  card?.remove();
  card = null;

  if (!lyrics) {
    const noLyrics = document.createElement("div");
    noLyrics.id = "VividLyrics-Card";
    noLyrics.style.cssText = "padding:16px;color:var(--text-base);font-size:14px;opacity:0.5;";
    noLyrics.textContent = "No lyrics available";
    card = noLyrics;
  } else {
    card = renderCard(lyrics);
  }

  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

function showLoading() {
  card?.remove();
  const loading = document.createElement("div");
  loading.id = "VividLyrics-Card";
  loading.style.cssText = "padding:16px;color:var(--text-base);font-size:14px;opacity:0.5;";
  loading.textContent = "Loading lyrics...";
  card = loading;

  const anchor = document.querySelector(ANCHOR) ?? document.querySelector(ANCHOR_FALLBACK);
  if (anchor) anchor.after(card);
}

async function onSongChange() {
  const uri = getTrackUri();
  console.log("[VividLyrics] songChange uri:", uri);
  if (!uri) return;

  showLoading();
  await loadLyrics(uri);
}

function suppressNativeLyrics(container: Element) {
  const native = container.querySelector<HTMLDivElement>(NATIVE_LYRICS_QUERY);
  if (native) native.style.display = "none";
}

function observeNPV() {
  let current: Element | null = null;
  let removeCb: (() => void) | null = null;
  let nativeObserver: MutationObserver | null = null;
  let lyricsUnsub: (() => void) | null = null;

  const check = () => {
    const el = document.body.querySelector(`${ANCHOR}, ${ANCHOR_FALLBACK}`);
    console.log("[VividLyrics] observeNPV check:", el ? "found" : "not found");
    if (el && el !== current) {
      if (current && removeCb) removeCb();
      current = el;

      suppressNativeLyrics(el.parentElement!);
      nativeObserver = new MutationObserver(() => suppressNativeLyrics(el.parentElement!));
      nativeObserver.observe(el.parentElement!, { childList: true });

      const handler = () => onSongChange();
      Spicetify.Player.addEventListener("songchange", handler);

      lyricsUnsub = onLyricsChange((lyrics) => mountCard(lyrics));
      onSongChange();

      removeCb = () => {
        Spicetify.Player.removeEventListener("songchange", handler);
        nativeObserver?.disconnect();
        lyricsUnsub?.();
        card?.remove();
        card = null;
      };
    } else if (!el && current) {
      if (removeCb) removeCb();
      removeCb = null;
      current = null;
    }
  };

  const observer = new MutationObserver(check);
  check();
  observer.observe(document.body, { childList: true, subtree: true });
}

export function setupCardView() {
  observeNPV();
}
