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

type SwatchName =
  | "Vibrant"
  | "LightVibrant"
  | "DarkVibrant"
  | "Muted"
  | "LightMuted"
  | "DarkMuted";

interface AccentCandidate {
  name: SwatchName;
  hex: string;
  population: number;
  saturation: number;
  lightness: number;
  roleBonus: number;
}

const SWATCH_ROLE_BONUS: Record<SwatchName, number> = {
  Vibrant: 24,
  LightVibrant: 18,
  DarkVibrant: 16,
  Muted: 6,
  LightMuted: 3,
  DarkMuted: 2,
};

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function cssColorToHex(color: string): string | null {
  const value = color.trim();
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (/^#[\da-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split("").map((part) => part + part).join("")}`;
  }

  const channels = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!channels) return null;
  return `#${channels
    .slice(1, 4)
    .map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function getLyricsBackground(): string {
  if (typeof document === "undefined") return "#121212";

  const styles = getComputedStyle(document.documentElement);
  for (const property of ["--background-tinted-base", "--background-base", "--spice-main"]) {
    const color = cssColorToHex(styles.getPropertyValue(property));
    if (color) return color;
  }
  return "#121212";
}

/** Adjust only as much lightness as needed for readable highlighted lyric text. */
function ensureTextContrast(hex: string, background: string, minimumRatio = 4.5): string {
  if (contrastRatio(hex, background) >= minimumRatio) return hex;

  const [h, s, originalLightness] = hexToHsl(hex);
  for (let distance = 1; distance <= 100; distance++) {
    const lighter = originalLightness + distance;
    const darker = originalLightness - distance;

    if (lighter <= 100) {
      const candidate = hslToHex(h, s, lighter);
      if (contrastRatio(candidate, background) >= minimumRatio) return candidate;
    }
    if (darker >= 0) {
      const candidate = hslToHex(h, s, darker);
      if (contrastRatio(candidate, background) >= minimumRatio) return candidate;
    }
  }

  return contrastRatio("#ffffff", background) >= contrastRatio("#000000", background)
    ? "#ffffff"
    : "#000000";
}

/**
 * Intelligent color decider:
 * Evaluates extracted swatches using both chromatic energy and pixel population
 * to filter out compression noise artifacts (e.g. tiny 10-pixel shadow noise in B&W covers)
 * and select the true dominant artistic accent color.
 */
function pickAccentColor(palette: any): string {
  const candidates = (Object.keys(SWATCH_ROLE_BONUS) as SwatchName[])
    .map((name): AccentCandidate | null => {
      const swatch = palette[name];
      if (!swatch?.hex) return null;
      const [, saturation, lightness] = hexToHsl(swatch.hex);
      return {
        name,
        hex: swatch.hex,
        population: Math.max(swatch.population || 1, 1),
        saturation,
        lightness,
        roleBonus: SWATCH_ROLE_BONUS[name],
      };
    })
    .filter((candidate): candidate is AccentCandidate => candidate !== null);

  if (candidates.length === 0) return "#ffffff";

  // Semantic swatch populations are relative signals, not a literal percentage
  // of every image pixel, so use adaptive thresholds rather than one hard cutoff.
  const totalPopulation = candidates.reduce((sum, candidate) => sum + candidate.population, 0);
  const dominant = candidates.reduce((largest, candidate) =>
    candidate.population > largest.population ? candidate : largest,
  );

  let winner: AccentCandidate | null = null;
  let highestScore = -1;

  for (const candidate of candidates) {
    const popRatio = candidate.population / totalPopulation;

    // Always reject microscopic clusters, but allow a small cluster through when
    // it is vivid enough to plausibly be intentional typography or artwork.
    if (candidates.length > 1 && (popRatio < 0.003 || (popRatio < 0.008 && candidate.saturation < 55))) {
      continue;
    }

    let score =
      candidate.saturation * 1.6 +
      Math.sqrt(popRatio) * 35 +
      candidate.roleBonus +
      (25 - Math.min(Math.abs(candidate.lightness - 54), 25));

    // Soft penalties keep background-like colors available for genuinely
    // monochrome covers without letting them beat a meaningful chromatic accent.
    if (candidate.saturation < 18) score -= 50;
    if (candidate.lightness < 12) score -= 45;
    if (candidate.lightness > 92) score -= 35;

    // Reward a small artistic focal point when it is substantially more colorful
    // than the cover's dominant semantic swatch.
    if (candidate.name.includes("Vibrant") && candidate.saturation > dominant.saturation + 25) {
      score += 20;
    }

    if (score > highestScore) {
      highestScore = score;
      winner = candidate;
    }
  }

  // Never accidentally return a candidate that the filters rejected.
  if (!winner || winner.saturation < 12) {
    return ensureTextContrast("#ffffff", getLyricsBackground());
  }

  const [h, saturation, lightness] = hexToHsl(winner.hex);
  let normalized = winner.hex;

  if (lightness < 40 || lightness > 65) {
    // Do not invent strong color in genuinely muted artwork.
    const normalizedSaturation = saturation < 20 ? saturation : Math.max(saturation, 42);
    normalized = hslToHex(h, normalizedSaturation, 54);
  }

  return ensureTextContrast(normalized, getLyricsBackground());
}

/**
 * Extract semantic color palette from an album art image URL using node-vibrant.
 * Results are cached in memory for instantaneous sub-millisecond retrieval on repeat plays.
 */
export async function extractPalette(rawUrl: string | null | undefined): Promise<PaletteColors> {
  const imageUrl = normalizeSpotifyImageUrl(rawUrl);
  if (!imageUrl) return DEFAULT_PALETTE;

  const cached = paletteCache.get(imageUrl);
  if (cached) {
    // Refresh insertion order so Map eviction behaves as a true LRU cache.
    paletteCache.delete(imageUrl);
    paletteCache.set(imageUrl, cached);
    return cached;
  }

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
  let requestGeneration = 0;

  async function updatePalette() {
    const generation = ++requestGeneration;
    const item = Spicetify?.Player?.data?.item;
    // Spicetify's metadata type does not declare every image-size key exposed at runtime.
    const meta =
      (item as unknown as { metadata?: Record<string, string | undefined> } | undefined)?.metadata ?? {};
    const rawUrl =
      meta?.image_xlarge_url ||
      meta?.image_large_url ||
      meta?.image_url ||
      meta?.image_small_url ||
      (item as any)?.album?.images?.[0]?.url ||
      (item as any)?.images?.[0]?.url;

    const palette = await extractPalette(rawUrl);
    if (generation !== requestGeneration) return;

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
