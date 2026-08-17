import { Vibrant } from "node-vibrant/browser";

export interface PaletteColors {
  vibrant: string;
  darkVibrant: string;
  lightVibrant: string;
  muted: string;
  darkMuted: string;
  lightMuted: string;
  accent: string; // The intelligently selected & contrast-optimized accent color
}

const DEFAULT_PALETTE: PaletteColors = {
  vibrant: "#1db954",
  darkVibrant: "#121212",
  lightVibrant: "#1ed760",
  muted: "#535353",
  darkMuted: "#181818",
  lightMuted: "#b3b3b3",
  accent: "#1ed760",
};

// In-memory LRU cache to avoid re-extracting palettes for visited tracks
const paletteCache = new Map<string, PaletteColors>();
const MAX_CACHE_SIZE = 50;

function normalizeSpotifyImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith("spotify:image:")) {
    return "https://i.scdn.co/image/" + url.replace("spotify:image:", "");
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return "https://i.scdn.co/image/" + url;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function hexToHsl(hex: string): [number, number, number] {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lum = l / 100;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lum - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Intelligent color decider:
 * Evaluates extracted swatches using both chromatic energy and pixel population
 * to filter out compression noise artifacts (e.g. tiny 10-pixel shadow noise in B&W covers)
 * and select the true dominant artistic accent color.
 */
function pickAccentColor(palette: any): string {
  const swatches = [
    palette.Vibrant,
    palette.Muted,
    palette.LightVibrant,
    palette.DarkVibrant,
    palette.LightMuted,
    palette.DarkMuted,
  ].filter((s): s is NonNullable<typeof s> => Boolean(s && s.hex));

  if (swatches.length === 0) return "#ffffff";

  // Total population across valid swatches to gauge real visual presence
  const totalPop = swatches.reduce((sum, s) => sum + (s.population || 1), 0);

  let bestHex = swatches[0].hex;
  let highestScore = -1;

  for (const sObj of swatches) {
    const hex = sObj.hex;
    const pop = sObj.population || 1;
    const popRatio = pop / totalPop;

    // Discard only microscopic noise artifacts (< 0.8% of colored pixels or tiny pixel counts)
    if (popRatio < 0.008 && swatches.length > 1) {
      continue;
    }

    const [, s, l] = hexToHsl(hex);

    // Skip grayscale/monochrome noise or near-black shadows (L < 18%)
    if (s < 12 || l < 18) continue;

    // Chromatic saturation is the primary driver (so green text & golden clouds win)
    // with gentle population tie-breaking
    let score = s * 2.0 + Math.sqrt(popRatio) * 10;
    if (l >= 30 && l <= 68) score += 25; // Ideal rich saturation range

    if (score > highestScore) {
      highestScore = score;
      bestHex = hex;
    }
  }

  const [h, s, l] = hexToHsl(bestHex);

  if (s < 12) return "#ffffff";

  // If moderately dark (L < 40% on dark cards), lift to rich 54%
  if (l < 40) {
    return hslToHex(h, Math.max(s, 50), 54);
  }
  // If overly pale/washed-out (L > 65%), tone down to rich 54% for deep color saturation
  if (l > 65) {
    return hslToHex(h, Math.max(s, 50), 54);
  }

  return bestHex;
}

/**
 * Extract semantic color palette from an album art image URL using node-vibrant.
 * Results are cached in memory for instantaneous sub-millisecond retrieval on repeat plays.
 */
export async function extractPalette(rawUrl: string | null | undefined): Promise<PaletteColors> {
  const imageUrl = normalizeSpotifyImageUrl(rawUrl);
  if (!imageUrl) return DEFAULT_PALETTE;

  const cached = paletteCache.get(imageUrl);
  if (cached) return cached;

  try {
    const img = await loadImage(imageUrl);
    const palette = await Vibrant.from(img)
      .maxColorCount(32)
      .quality(5)
      .getPalette();

    const vibrant = palette.Vibrant?.hex ?? DEFAULT_PALETTE.vibrant;
    const lightVibrant = palette.LightVibrant?.hex ?? DEFAULT_PALETTE.lightVibrant;
    const darkVibrant = palette.DarkVibrant?.hex ?? DEFAULT_PALETTE.darkVibrant;
    const muted = palette.Muted?.hex ?? DEFAULT_PALETTE.muted;
    const darkMuted = palette.DarkMuted?.hex ?? DEFAULT_PALETTE.darkMuted;
    const lightMuted = palette.LightMuted?.hex ?? DEFAULT_PALETTE.lightMuted;

    const accent = pickAccentColor(palette);

    const result: PaletteColors = {
      vibrant,
      darkVibrant,
      lightVibrant,
      muted,
      darkMuted,
      lightMuted,
      accent,
    };

    if (paletteCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = paletteCache.keys().next().value;
      if (oldestKey) paletteCache.delete(oldestKey);
    }
    paletteCache.set(imageUrl, result);

    console.groupCollapsed(
      `%c[VividLyrics] Palette Extracted: ${result.accent}`,
      `color: ${result.accent}; font-weight: bold;`,
    );
    console.log("%c ★ ACCENT COLOR", `background: ${result.accent}; color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: bold; text-shadow: 0 1px 2px #000;`, result.accent);
    console.log("%c Vibrant      ", `background: ${result.vibrant}; color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: bold;`, result.vibrant);
    console.log("%c LightVibrant ", `background: ${result.lightVibrant}; color: #000; padding: 2px 6px; border-radius: 3px;`, result.lightVibrant);
    console.log("%c DarkVibrant  ", `background: ${result.darkVibrant}; color: #fff; padding: 2px 6px; border-radius: 3px;`, result.darkVibrant);
    console.log("%c Muted        ", `background: ${result.muted}; color: #fff; padding: 2px 6px; border-radius: 3px;`, result.muted);
    console.log("%c LightMuted   ", `background: ${result.lightMuted}; color: #000; padding: 2px 6px; border-radius: 3px;`, result.lightMuted);
    console.log("%c DarkMuted    ", `background: ${result.darkMuted}; color: #fff; padding: 2px 6px; border-radius: 3px;`, result.darkMuted);
    console.groupEnd();

    return result;
  } catch (err) {
    console.warn("[VividLyrics] Palette extraction failed for", imageUrl, err);
    return DEFAULT_PALETTE;
  }
}

/**
 * Initializes automatic songchange listening and applies extracted album
 * art palette variables to the document root.
 */
export function setupDynamicColors(): void {
  async function updatePalette() {
    const item = Spicetify?.Player?.data?.item;
    const meta = item?.metadata as Record<string, string | undefined> | undefined;
    const rawUrl =
      meta?.image_xlarge_url ||
      meta?.image_large_url ||
      meta?.image_url ||
      meta?.image_small_url ||
      (item as any)?.album?.images?.[0]?.url ||
      (item as any)?.images?.[0]?.url;

    const palette = await extractPalette(rawUrl);
    const root = document.documentElement;

    root.style.setProperty("--vl-accent-color", palette.accent);
    root.style.setProperty("--vl-accent-vibrant", palette.vibrant);
    root.style.setProperty("--vl-accent-dark-vibrant", palette.darkVibrant);
    root.style.setProperty("--vl-accent-light-vibrant", palette.lightVibrant);
    root.style.setProperty("--vl-accent-muted", palette.muted);
    root.style.setProperty("--vl-accent-dark-muted", palette.darkMuted);
    root.style.setProperty("--vl-accent-light-muted", palette.lightMuted);
  }

  Spicetify?.Player?.addEventListener("songchange", updatePalette);
  updatePalette();
}

