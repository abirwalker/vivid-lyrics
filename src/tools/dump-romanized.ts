/**
 * Unified Romanization Dumping & Debugging Tool
 *
 * Provides formatted console dumping of original vs romanized lyric pairs for all
 * supported languages (Bengali, Japanese, Chinese, Cantonese, Korean, Thai).
 * Also attaches a global `window.dumpRomanizedLyrics()` helper for interactive inspection.
 */

export interface RomanizedLinePair {
  original: string;
  romanized: string;
}

let lastRomanizedDump: {
  language: string;
  pairs: Array<[string, string]>;
  timestamp: number;
} | null = null;

/**
 * Dump full romanized lyrics to the console with styled headers.
 */
export function dumpRomanizedLyrics(
  pairs: Array<[string, string]>,
  language: string = "Unknown"
): void {
  if (!pairs.length) return;

  lastRomanizedDump = {
    language,
    pairs,
    timestamp: Date.now(),
  };

  console.log(
    `%c[VividLyrics][romanized-dump] ===== FULL ROMANIZED LYRICS (${language.toUpperCase()}) =====`,
    "color: #1db954; font-weight: bold; font-size: 11px;"
  );

  for (const [original, romanized] of pairs) {
    if (!original && !romanized) {
      console.log("—");
      continue;
    }
    console.log(`%c${original}%c  ->  %c${romanized}`, "color: #e0e0e0;", "color: #888;", "color: #1db954; font-weight: 500;");
  }

  console.log("%c════════════════════════════════════════════════════════════", "color: #1db954;");
}

/**
 * Get the last cached romanization dump.
 */
export function getLastRomanizedDump() {
  return lastRomanizedDump;
}

// Expose on window in browser / Spicetify environment for interactive DevTools inspection
if (typeof window !== "undefined") {
  (window as any).dumpRomanizedLyrics = () => {
    if (!lastRomanizedDump) {
      console.log("%c[VividLyrics] No romanized lyrics have been loaded yet.", "color: #ff9800;");
      return;
    }
    dumpRomanizedLyrics(lastRomanizedDump.pairs, lastRomanizedDump.language);
  };
}
