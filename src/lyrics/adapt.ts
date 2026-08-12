import type { TransformedLyrics } from "./types";
import { romanizeBengali, romanizeCantonese, romanizeChinese, romanizeJP, romanizeKorean } from "../utils/romanize";
import { romanizeThaiLine } from "../utils/romanize-th";
import {
  buildKanaWithTokenBoundaries,
  hasRomanizationBoundaryAt,
  kanaToRomaji,
  tokenizeAndReadFullLine,
  type LineCharReading,
  type LineReading,
  type TokenReading,
} from "../utils/romanize-jp";

// ---------------------------------------------------------------------------
// Kana → per-syllable romaji assembly
// ---------------------------------------------------------------------------

const NBSP = "\u00A0";

/**
 * Build the kana segment for a syllable's character range [start, end).
 * Token boundaries inside the range become NBSP (or nothing when the next
 * token should attach, e.g. て/ない/れる).
 */
export function buildSyllableKana(
  chars: LineCharReading[],
  tokens: TokenReading[],
  start: number,
  end: number,
): string {
  return buildKanaWithTokenBoundaries(chars, tokens, start, end, NBSP);
}

function syllableRomaji(reading: LineReading, start: number, end: number): Promise<string> {
  const seg = buildSyllableKana(reading.chars, reading.tokens, start, end);
  if (!seg) return Promise.resolve("");
  return kanaToRomaji(seg).then((romaji) => romaji || (seg === "っ" ? "tsu" : seg));
}

const RTL_LANGS = ["ara", "ar", "heb", "he", "fas", "fa", "urd", "ur"];

const API_LANG_MAP: Record<string, string> = {
  jpn: "Japanese", ja: "Japanese",
  cmn: "Chinese", zh: "Chinese", zho: "Chinese", chi: "Chinese", cn: "Chinese",
  yue: "Cantonese",
  kor: "Korean", ko: "Korean",
  rus: "Russian", ru: "Russian",
  ukr: "Ukrainian", uk: "Ukrainian",
  bel: "Belarusian", be: "Belarusian",
  bul: "Bulgarian", bg: "Bulgarian",
  srp: "Serbian", sr: "Serbian",
  mkd: "Macedonian", mk: "Macedonian",
  ell: "Greek", el: "Greek",
  ara: "Arabic", ar: "Arabic",
  heb: "Hebrew", he: "Hebrew",
  hin: "Hindi", hi: "Hindi",
  ben: "Bengali", bn: "Bengali",
  tha: "Thai", th: "Thai",
};

const SCRIPT_TESTS: [RegExp, string][] = [
  [/[\u3040-\u309F\u30A0-\u30FF]/, "Japanese"],
  [/[\uAC00-\uD7AF\u1100-\u11FF]/, "Korean"],
  [/[\u0400-\u04FF]/, "Cyrillic"],
  [/[\u0370-\u03FF]/, "Greek"],
  [/[\u0600-\u06FF]/, "Arabic"],
  [/[\u0590-\u05FF]/, "Hebrew"],
  [/[\u0900-\u097F]/, "Hindi"],
  [/[\u0980-\u09FF]/, "Bengali"],
  [/[\u0E00-\u0E7F]/, "Thai"],
  [/[\u4E00-\u9FFF]/, "Chinese"],
];

function fromApiCode(lang?: string): string | undefined {
  if (!lang || lang === "und") return undefined;
  const normalized = lang.toLowerCase().replace(/_/g, "-");
  return API_LANG_MAP[normalized] ?? API_LANG_MAP[normalized.split("-")[0]];
}

export function fromScript(text: string): string | undefined {
  for (const [re, name] of SCRIPT_TESTS) {
    if (re.test(text)) return name;
  }
  return undefined;
}

// Majority vote over every lyric string instead of first-match. One stray
// CJK char in a transliteration line can no longer poison the whole song.
function detectLanguage(response: any): string | undefined {
  const votes: Record<string, number> = {};
  const tally = (text: string) => {
    const r = fromScript(text);
    if (r) votes[r] = (votes[r] ?? 0) + 1;
  };

  for (const g of response.Content ?? []) {
    if (g.Type !== "Vocal") continue;
    for (const s of g.Lead?.Syllables ?? []) tally(s.Text ?? "");
    tally(g.Text ?? "");
  }
  for (const l of response.Lines ?? []) tally(l.Text ?? "");

  let best: string | undefined;
  let bestCount = 0;
  for (const [name, count] of Object.entries(votes)) {
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

function getEndTime(content: any[]): number {
  if (!content?.length) return 0;
  const last = content[content.length - 1];
  if (last.Type === "Vocal" && last.Lead) return last.Lead.EndTime ?? 0;
  return last.EndTime ?? 0;
}

export function adaptLyrics(response: any): TransformedLyrics {
  const lang = response.Language ?? response.LanguageISO2 ?? "und";
  const langLower = lang.toLowerCase();

  // A Japanese ISO code is authoritative: kanji-only JP lyrics carry no kana,
  // so script scanning would misread them as Chinese. Trust the code outright.
  let romanized: string | undefined;
  if (langLower === "ja" || langLower === "jpn") {
    romanized = "Japanese";
  } else {
    const apiLang = fromApiCode(lang);
    romanized = apiLang ?? detectLanguage(response);
  }
  romanized ??= "Latin";

  const base = {
    naturalAlignment: RTL_LANGS.includes(lang.toLowerCase()) ? "Right" as const : "Left" as const,
    language: lang,
    romanizedLanguage: romanized,
    ...(response.SongWriters ? { songWriters: response.SongWriters } : {}),
  };

  if (response.Type === "Static") {
    const raw = response.Lines ?? response.lines ?? [];
    const lines = raw.map((l: any) => {
      if (typeof l === "string") return { text: l };
      return { text: l.Text ?? l.text ?? "", romanizedText: l.RomanizedText ?? l.romanizedText };
    });
    return { ...base, type: "Static", lines };
  }
  if (response.Type === "Line") {
    return {
      ...base,
      type: "Line",
      startTime: response.StartTime ?? 0,
      endTime: response.EndTime ?? getEndTime(response.Content ?? []),
      content: response.Content ?? [],
    };
  }
  if (response.Type === "Syllable") {
    return {
      ...base,
      type: "Syllable",
      startTime: response.StartTime ?? 0,
      endTime: response.EndTime ?? getEndTime(response.Content ?? []),
      content: response.Content ?? [],
    };
  }

  throw new Error(`Unknown lyrics type: ${response.Type}`);
}

function dumpRomanizedLyrics(pairs: Array<[string, string]>): void {
  if (!pairs.length) return;
  console.log("%c[VividLyrics][romanized-dump] ===== FULL ROMANIZED LYRICS =====", "color: #1db954; font-weight: bold");
  for (const [original, romanized] of pairs) {
    console.log(`${original}  ->  ${romanized}`);
  }
  console.log("════════════════════════════════════════════════");
}

export async function fillRomanizedText(lyrics: TransformedLyrics): Promise<void> {
  const language = lyrics.romanizedLanguage;
  if (
    language !== "Japanese" && language !== "Chinese" && language !== "Cantonese" &&
    language !== "Korean" && language !== "Thai" && language !== "Bengali"
  ) return;

  if (language !== "Japanese") {
    const romanize =
      language === "Cantonese" ? romanizeCantonese
      : language === "Korean" ? romanizeKorean
      : language === "Thai" ? romanizeThaiLine
      : language === "Bengali" ? romanizeBengali
      : romanizeChinese;
    await fillSimpleRomanizedText(lyrics, romanize, language);
    return;
  }

  const t0 = performance.now();
  const romanizedDump: Array<[string, string]> = [];
  let fromApi = 0;
  let fromLindera = 0;

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      if (!line.romanizedText && line.text) {
        line.romanizedText = await romanizeJP(line.text);
        fromLindera++;
      } else if (line.romanizedText) {
        fromApi++;
      }
      if (line.romanizedText) romanizedDump.push([line.text, line.romanizedText]);
    }
    console.log(`[VividLyrics] fillRomanizedText: ${lyrics.lines.length} static lines — ${fromApi} from API, ${fromLindera} via Lindera (${Math.round(performance.now() - t0)}ms)`);
    dumpRomanizedLyrics(romanizedDump);
    return;
  }

  // Line and Syllable types use raw API objects with capital field names
  const content = (lyrics as any).content ?? [];
  let romanized = 0;
  for (const item of content) {
    if (item.type === "Interlude" || item.Type === "Interlude") continue;

    // Syllable type — romanize the full line, then map to syllables
    const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
    if (syllables.length > 0) {
      const allExist = syllables.every((s: any) => s.romanizedText ?? s.RomanizedText);
      if (!allExist) {
        const fullText = syllables.map((s: any) => s.text ?? s.Text ?? "").join("");
        if (fullText) {
          const providerWordStarts = new Set<number>();
          let providerOffset = 0;
          for (let i = 0; i < syllables.length; i++) {
            const s = syllables[i];
            if (i > 0 && !syllables[i - 1].IsPartOfWord) {
              providerWordStarts.add(providerOffset);
            }
            providerOffset += [...(s.text ?? s.Text ?? "")].length;
          }
          const reading = await tokenizeAndReadFullLine(fullText, providerWordStarts);

          let charOffset = 0;
          for (let sIdx = 0; sIdx < syllables.length; sIdx++) {
            const s = syllables[sIdx];
            const sText = s.text ?? s.Text ?? "";
            const sLen = [...sText].length;
            if (sLen === 0) { charOffset += sLen; continue; }

            let romaji = "";
            if (reading) {
              s.RomanizedStartsWord = hasRomanizationBoundaryAt(
                reading.chars,
                reading.tokens,
                charOffset,
              );
              s.romanizedStartsWord = s.RomanizedStartsWord;
              romaji = await syllableRomaji(reading, charOffset, charOffset + sLen);
            } else {
              // Tokenizer unavailable — per-syllable romanizeJP fallback
              romaji = await romanizeJP(sText);
            }

            if (romaji) {
              s.romanizedText = romaji;
              s.RomanizedText = romaji;
              romanized++;
              fromLindera++;
            }
            charOffset += sLen;
          }
        }
      } else {
        romanized += syllables.length;
        fromApi += syllables.length;
      }
      continue;
    }

    // Line type — romanize the whole line
    const text = item.text ?? item.Text ?? "";
    const existing = item.romanizedText ?? item.RomanizedText;
    if (!existing && text) {
      item.romanizedText = await romanizeJP(text);
      item.RomanizedText = item.romanizedText;
      romanized++;
      fromLindera++;
    } else if (existing) {
      fromApi++;
    }
  }
  // Background tracks are timed independently from the lead, so process each
  // complete track as its own line. This keeps the tokenizer's word boundaries
  // and avoids leaking original Japanese when romanization is enabled.
  for (const item of content) {
    for (const track of item.Background ?? item.background ?? []) {
      const syllables: any[] = track.Syllables ?? track.syllables ?? [];
      if (!syllables.length) continue;
      if (syllables.every((s: any) => s.romanizedText ?? s.RomanizedText)) {
        fromApi += syllables.length;
        continue;
      }

      const fullText = syllables.map((s: any) => s.text ?? s.Text ?? "").join("");
      if (!fullText) continue;
      const wordStarts = new Set<number>();
      let sourceOffset = 0;
      for (let index = 0; index < syllables.length; index++) {
        if (index > 0 && !syllables[index - 1].IsPartOfWord) wordStarts.add(sourceOffset);
        sourceOffset += [...(syllables[index].text ?? syllables[index].Text ?? "")].length;
      }
      const reading = await tokenizeAndReadFullLine(fullText, wordStarts);
      let charOffset = 0;
      for (const syllable of syllables) {
        const text = syllable.text ?? syllable.Text ?? "";
        const charLength = [...text].length;
        if (!charLength) continue;
        const value = reading
          ? await syllableRomaji(reading, charOffset, charOffset + charLength)
          : await romanizeJP(text);
        if (reading) {
          syllable.RomanizedStartsWord = hasRomanizationBoundaryAt(reading.chars, reading.tokens, charOffset);
          syllable.romanizedStartsWord = syllable.RomanizedStartsWord;
        }
        if (value) {
          syllable.romanizedText = value;
          syllable.RomanizedText = value;
          romanized++;
          fromLindera++;
        }
        charOffset += charLength;
      }
    }
  }

  console.log(`[VividLyrics] fillRomanizedText: ${content.length} items — ${fromApi} from API, ${fromLindera} via Lindera in ${Math.round(performance.now() - t0)}ms`);

  // Build romanized dump for debugging / comparison
  for (const item of content) {
    if (item.type === "Interlude" || item.Type === "Interlude") { romanizedDump.push(["", ""]); continue; }

    const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
    if (syllables.length > 0) {
      // Regenerate the whole line with proper token-boundary spacing. The
      // per-syllable pieces can't do this: a boundary falling between two
      // syllables would lose its NBSP in the concatenation.
      const fullText = syllables.map((s: any) => s.text ?? s.Text ?? "").join("");
      romanizedDump.push(fullText ? [fullText, await romanizeJP(fullText)] : ["", ""]);
    } else {
      romanizedDump.push([item.text ?? item.Text ?? "", item.romanizedText ?? item.RomanizedText ?? ""]);
    }
  }

  dumpRomanizedLyrics(romanizedDump);
}

/** Fill non-Japanese romanization without changing the provider's syllable timing. */
async function fillSimpleRomanizedText(
  lyrics: TransformedLyrics,
  romanize: (text: string) => string | Promise<string>,
  language: "Chinese" | "Cantonese" | "Korean" | "Thai" | "Bengali",
): Promise<void> {
  let generated = 0;
  let fromApi = 0;

  const fill = async (target: any, text: string): Promise<void> => {
    const existing = target.romanizedText ?? target.RomanizedText;
    if (existing) {
      fromApi++;
      return;
    }
    if (!text) return;
    const value = await romanize(text);
    if (!value) return;
    target.romanizedText = value;
    target.RomanizedText = value;
    generated++;
  };

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) await fill(line, line.text);
    console.log(`[VividLyrics] fillRomanizedText: ${lyrics.lines.length} static ${language} lines — ${fromApi} from API, ${generated} generated`);
    const dumpLines = lyrics.lines.map((line) => [line.text, line.romanizedText ?? ""] as [string, string]);
    dumpRomanizedLyrics(dumpLines);
    return;
  }

  const content = (lyrics as any).content ?? [];
  for (const item of content) {
    if (item.type === "Interlude" || item.Type === "Interlude") continue;
    const vocalTracks = [
      item.Lead?.Syllables ?? item.lead?.syllables,
      ...(item.Background ?? item.background ?? []).map((track: any) => track.Syllables ?? track.syllables),
    ].filter((track: unknown): track is any[] => Array.isArray(track) && track.length > 0);
    if (vocalTracks.length > 0) {
      for (const syllables of vocalTracks) {
        for (let index = 0; index < syllables.length; index++) {
          const syllable = syllables[index];
          const startsWord = index === 0 || !syllables[index - 1].IsPartOfWord;
          syllable.RomanizedStartsWord = startsWord;
          syllable.romanizedStartsWord = startsWord;
          await fill(syllable, syllable.text ?? syllable.Text ?? "");
        }
      }
    } else {
      await fill(item, item.text ?? item.Text ?? "");
    }
  }
  console.log(`[VividLyrics] fillRomanizedText: ${content.length} ${language} items — ${fromApi} from API, ${generated} generated`);

  // Build the full-line romanized dump for debugging / comparison (matches
  // the JP path: re-romanize the joined line so word-level spacing is right).
  const dumpLines: Array<[string, string]> = [];
  for (const item of content) {
    if (item.type === "Interlude" || item.Type === "Interlude") { dumpLines.push(["", ""]); continue; }
    const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
    if (syllables.length > 0) {
      const fullText = syllables.map((s: any) => s.text ?? s.Text ?? "").join("");
      dumpLines.push(fullText ? [fullText, await romanize(fullText)] : ["", ""]);
    } else {
      dumpLines.push([item.text ?? item.Text ?? "", item.romanizedText ?? item.RomanizedText ?? ""]);
    }
  }
  dumpRomanizedLyrics(dumpLines);
}
