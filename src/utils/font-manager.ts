import { get, type Settings } from "../stores/settings";
import storage from "./storage";

const SPICY_FONT_CSS_URL = "https://fonts.spikerko.org/spicy-lyrics/source.css";
const SPICY_FONT_CACHE_KEY = "spicy-font-css";
const CUSTOM_FONT_LINK_ID = "VL-font-custom-stylesheet";
export const CUSTOM_FONT_FAMILY = "Vivid Lyrics Custom";
const CUSTOM_FONT_TIMEOUT = 12_000;
const DIRECT_FONT_EXTENSIONS = /\.(?:woff2?|ttf|otf)$/i;

const GOOGLE_FONTS: Partial<Record<Settings["fontFamily"], string>> = {
  outfit: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap",
  "crimson-pro": "https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400..900;1,400..900&display=swap",
  "jetbrains-mono": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap",
  "patrick-hand": "https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap",
};

const ALL_FONT_CLASSES = [
  "vl-font-default",
  "vl-font-spicy",
  "vl-font-outfit",
  "vl-font-crimson-pro",
  "vl-font-jetbrains-mono",
  "vl-font-patrick-hand",
  "vl-font-custom",
];

let spicyFontInjected = false;
let customFontGeneration = 0;
let activeCustomFontFace: FontFace | null = null;

function injectFontCSS(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

async function ensureSpicyFont(): Promise<void> {
  if (spicyFontInjected) return;

  const cached = storage.get(SPICY_FONT_CACHE_KEY);
  if (cached) {
    injectFontCSS(cached);
    spicyFontInjected = true;
    return;
  }

  const cssRes = await fetch(SPICY_FONT_CSS_URL);
  const rawCSS = await cssRes.text();
  const fontMatches = [...rawCSS.matchAll(/url\(([^)]+)\)/g)];
  let resolved = rawCSS;

  for (const match of fontMatches) {
    const relativePath = match[1];
    const absoluteURL = new URL(relativePath, SPICY_FONT_CSS_URL).href;
    const fontRes = await fetch(absoluteURL);
    const buffer = await fontRes.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((result, byte) => result + String.fromCharCode(byte), ""),
    );
    resolved = resolved.replace(match[0], `url(data:font/woff2;base64,${base64})`);
  }

  storage.set(SPICY_FONT_CACHE_KEY, resolved);
  injectFontCSS(resolved);
  spicyFontInjected = true;
}

function ensureGoogleFont(font: Settings["fontFamily"]): void {
  const id = `VL-font-${font}`;
  if (document.getElementById(id)) return;
  const url = GOOGLE_FONTS[font];
  if (!url) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Font loading timed out")), ms);
  });
}

function normalizeFontName(value: string): string {
  return value.trim().replace(/[+_-]+/g, " ").replace(/\s+/g, " ");
}

function setCustomFontFamily(family: string): void {
  document.documentElement.style.setProperty(
    "--vl-custom-font",
    `${JSON.stringify(family)}, var(--fallback-fonts, sans-serif)`,
  );
}

function discardActiveCustomSource(): void {
  document.getElementById(CUSTOM_FONT_LINK_ID)?.remove();
  if (activeCustomFontFace) {
    document.fonts.delete(activeCustomFontFace);
    activeCustomFontFace = null;
  }
}

async function loadFontFace(source: string, generation: number): Promise<string> {
  const face = new FontFace(CUSTOM_FONT_FAMILY, source);
  await Promise.race([face.load(), timeoutAfter(CUSTOM_FONT_TIMEOUT)]);
  if (generation !== customFontGeneration) {
    throw new Error("A newer font request replaced this one");
  }

  discardActiveCustomSource();
  document.fonts.add(face);
  activeCustomFontFace = face;
  setCustomFontFamily(CUSTOM_FONT_FAMILY);
  return CUSTOM_FONT_FAMILY;
}

async function loadGoogleStylesheet(
  url: string,
  family: string,
  generation: number,
): Promise<string> {
  const pending = document.createElement("link");
  pending.rel = "stylesheet";
  pending.dataset.vlCustomFontPending = "true";

  const loaded = new Promise<void>((resolve, reject) => {
    pending.addEventListener("load", () => resolve(), { once: true });
    pending.addEventListener(
      "error",
      () => reject(new Error(`Google Fonts could not find “${family}”`)),
      { once: true },
    );
  });

  pending.href = url;
  document.head.appendChild(pending);

  try {
    await Promise.race([loaded, timeoutAfter(CUSTOM_FONT_TIMEOUT)]);
    const faces = await Promise.race([
      document.fonts.load(`16px ${JSON.stringify(family)}`, "Aa"),
      timeoutAfter(CUSTOM_FONT_TIMEOUT),
    ]);
    if (!faces.length) throw new Error(`Google Fonts did not provide “${family}”`);
    if (generation !== customFontGeneration) {
      throw new Error("A newer font request replaced this one");
    }

    discardActiveCustomSource();
    pending.id = CUSTOM_FONT_LINK_ID;
    delete pending.dataset.vlCustomFontPending;
    setCustomFontFamily(family);
    return family;
  } catch (error) {
    pending.remove();
    throw error;
  }
}

function googleFontUrl(family: string): string {
  const url = new URL("https://fonts.googleapis.com/css2");
  url.searchParams.set("family", family);
  url.searchParams.set("display", "swap");
  return url.href;
}

function familyFromGoogleUrl(url: URL): string | null {
  if (url.hostname === "fonts.google.com") {
    const match = url.pathname.match(/^\/specimen\/([^/]+)/i);
    return match ? normalizeFontName(decodeURIComponent(match[1])) : null;
  }

  if (url.hostname !== "fonts.googleapis.com") return null;
  const family = url.searchParams.get("family")?.split("|")[0]?.split(":")[0];
  return family ? normalizeFontName(family) : null;
}

export async function loadCustomFont(input: string): Promise<string> {
  const value = input.trim();
  if (!value) throw new Error("Enter a font name or HTTPS font URL");

  const generation = ++customFontGeneration;
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(value);
  } catch {}

  if (parsedUrl) {
    if (parsedUrl.protocol !== "https:") throw new Error("Font URLs must use HTTPS");

    const googleFamily = familyFromGoogleUrl(parsedUrl);
    if (googleFamily) {
      const stylesheetUrl = parsedUrl.hostname === "fonts.google.com"
        ? googleFontUrl(googleFamily)
        : parsedUrl.href;
      return loadGoogleStylesheet(stylesheetUrl, googleFamily, generation);
    }

    if (!DIRECT_FONT_EXTENSIONS.test(parsedUrl.pathname)) {
      throw new Error("Use a Google Fonts link or a direct .woff2, .woff, .ttf, or .otf URL");
    }
    return loadFontFace(`url(${JSON.stringify(parsedUrl.href)})`, generation);
  }

  // Preserve the exact name for a local lookup, then normalize separators for Google.
  try {
    return await loadFontFace(`local(${JSON.stringify(value)})`, generation);
  } catch (error) {
    if (generation !== customFontGeneration) throw error;
  }

  const googleFamily = normalizeFontName(value);
  if (!googleFamily) throw new Error("Enter a valid font name");
  return loadGoogleStylesheet(googleFontUrl(googleFamily), googleFamily, generation);
}

export function applyFont(font: Settings["fontFamily"]): void {
  document.documentElement.classList.remove(...ALL_FONT_CLASSES);
  document.documentElement.classList.add(`vl-font-${font}`);

  if (font === "spicy") {
    void ensureSpicyFont().catch(() => {});
  } else if (font === "custom") {
    const saved = get("customFontName");
    if (saved) void loadCustomFont(saved).catch(() => {});
  } else if (font in GOOGLE_FONTS) {
    ensureGoogleFont(font);
  }
}
