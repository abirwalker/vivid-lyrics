import type { TransformedLyrics } from "./types";
import { romanizeJP } from "../utils/romanize";
import {
  kanaToRomaji,
  tokenizeAndReadFullLine,
  type LineCharReading,
  type LineReading,
  type TokenReading,
} from "../utils/romanize-jp";

// Lexical compounds that tokenizers incorrectly split were previously handled
// here (COMPOUND_WORDS). Removed — relying on raw tokenizer output instead.

function shouldAttach(prev: TokenReading, curr: TokenReading): boolean {
  // POS-based rules.
  // 助動詞 (auxiliary verbs like た/ない/れる) attach to content words, but NOT
  // to 助詞/形状詞 — so のように keeps spaces ("no you ni") while 見つけた stays
  // joined ("mitsuketa").
  const AUX_PREV = new Set(["動詞", "形容詞", "助動詞"]);
  if (curr.pos === "助動詞" && AUX_PREV.has(prev.pos)) return true;
  if (curr.pos === "接尾辞") return true;
  if (curr.pos_detail_1 === "接尾") return true;
  if (curr.pos === "動詞" && curr.pos_detail_1 === "非自立") return true;
  // 接頭辞 (全/未/超/ご...) never stands alone: 全生命 → "zenseimei".
  if (prev.pos === "接頭辞") return true;
  // なく/たく + なる: 見れなくなった → "mirenakunatta" (but 届いたり stays separate after なく).
  if (curr.pos === "動詞" && (prev.text === "なく" || prev.text === "たく") && curr.text.startsWith("な")) return true;

  // Common helper / inflection forms
  // て/で: only the te-form で (接続助詞) attaches — the particle で
  // (格助詞: 二人で/自転車で) keeps its space ("futari de").
  if (curr.text === "て" || (curr.text === "で" && curr.pos_detail_1 === "接続助詞")) return true;
  if (curr.text === "ば") return true;
  // いる/居る as 補助動詞 (non-自立可能) only after the te-form: 隠れている →
  // "kakureteiru", but 僕がいる → "boku ga iru".
  if ((curr.text === "いる" || curr.text === "居る") && prev.text === "て") return true;
  if (curr.text === "ない" && AUX_PREV.has(prev.pos)) return true;
  if (["れる", "られる", "せる", "させる"].includes(curr.text) && AUX_PREV.has(prev.pos)) return true;
  // た/だ attach to verbs/adjectives, but copula だ after a noun stays separate
  // ("genki da").
  if (["た", "だ"].includes(curr.text) && AUX_PREV.has(prev.pos)) return true;
  // か (副助詞) after an indefinite pronoun: いつか/何か/誰か → "itsuka".
  if (curr.pos === "助詞" && curr.pos_detail_1 === "副助詞" && curr.text === "か" && prev.pos === "代名詞") return true;
  // たり after a verb: 届いたり → "todoitari".
  if (curr.text === "たり" && (prev.pos === "動詞" || prev.pos === "助動詞")) return true;
  // きり (副助詞, "only") after a noun: 一人きり → "hitorikiri".
  if (curr.text === "きり" && prev.pos === "名詞") return true;

  return false;
}

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
  let seg = "";
  for (let i = start; i < end; i++) {
    const c = chars[i];
    if (!c) break;
    if (i > 0) {
      const prevC = chars[i - 1];
      if (c.tokenIndex !== prevC.tokenIndex) {
        const prevTok = tokens[prevC.tokenIndex];
        const currTok = tokens[c.tokenIndex];
        if (prevTok && currTok && !shouldAttach(prevTok, currTok)) seg += NBSP;
      }
    }
    seg += c.kana;
  }
  return seg;
}

/** Whole-line romaji with token-boundary spaces (particles already fixed). */
async function romanizeLineSpaced(text: string): Promise<string> {
  const reading = await tokenizeAndReadFullLine(text);
  if (!reading) return romanizeJP(text);
  let seg = "";
  for (let i = 0; i < reading.chars.length; i++) {
    const c = reading.chars[i];
    if (i > 0) {
      const prevC = reading.chars[i - 1];
      if (c.tokenIndex !== prevC.tokenIndex) {
        const prevTok = reading.tokens[prevC.tokenIndex];
        const currTok = reading.tokens[c.tokenIndex];
        if (!shouldAttach(prevTok, currTok)) seg += " ";
      }
    }
    seg += c.kana;
  }
  const romaji = await kanaToRomaji(seg);
  return romaji || seg;
}

function syllableRomaji(reading: LineReading, start: number, end: number): Promise<string> {
  const seg = buildSyllableKana(reading.chars, reading.tokens, start, end);
  if (!seg) return Promise.resolve("");
  return kanaToRomaji(seg).then((romaji) => romaji || (seg === "っ" ? "tsu" : seg));
}

const RTL_LANGS = ["ara", "ar", "heb", "he", "fas", "fa", "urd", "ur"];

const API_LANG_MAP: Record<string, string> = {
  jpn: "Japanese", ja: "Japanese",
  cmn: "Chinese", zh: "Chinese",
  yue: "Chinese",
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
  return API_LANG_MAP[lang.toLowerCase()];
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

function dumpRomanizedLyrics(lines: string[]): void {
  if (!lines.length) return;
  const header = "[VividLyrics][romanized-dump] ===== FULL ROMANIZED LYRICS =====";
  const body = lines.join("\n");
  const footer = "════════════════════════════════════════════════";
  console.log(`%c${header}\n${body}\n${footer}`, "color: #1db954; font-weight: bold");
}

export async function fillRomanizedText(lyrics: TransformedLyrics): Promise<void> {
  if (lyrics.romanizedLanguage !== "Japanese") return;

  const t0 = performance.now();
  const romanizedDump: string[] = [];
  let fromApi = 0;
  let fromLindera = 0;

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      if (!line.romanizedText && line.text) {
        line.romanizedText = await romanizeLineSpaced(line.text);
        fromLindera++;
      } else if (line.romanizedText) {
        fromApi++;
      }
      if (line.romanizedText) romanizedDump.push(line.romanizedText);
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
          const reading = await tokenizeAndReadFullLine(fullText);

          let charOffset = 0;
          for (let sIdx = 0; sIdx < syllables.length; sIdx++) {
            const s = syllables[sIdx];
            const sText = s.text ?? s.Text ?? "";
            const sLen = [...sText].length;
            if (sLen === 0) { charOffset += sLen; continue; }

            let romaji = "";
            if (reading) {
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
      item.romanizedText = await romanizeLineSpaced(text);
      item.RomanizedText = item.romanizedText;
      romanized++;
      fromLindera++;
    } else if (existing) {
      fromApi++;
    }
  }
  console.log(`[VividLyrics] fillRomanizedText: ${content.length} items — ${fromApi} from API, ${fromLindera} via Lindera in ${Math.round(performance.now() - t0)}ms`);

  // Build romanized dump for debugging / comparison
  for (const item of content) {
    if (item.type === "Interlude" || item.Type === "Interlude") { romanizedDump.push(""); continue; }

    const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
    if (syllables.length > 0) {
      // Regenerate the whole line with proper token-boundary spacing. The
      // per-syllable pieces can't do this: a boundary falling between two
      // syllables would lose its NBSP in the concatenation.
      const fullText = syllables.map((s: any) => s.text ?? s.Text ?? "").join("");
      romanizedDump.push(fullText ? await romanizeLineSpaced(fullText) : "");
    } else {
      romanizedDump.push(item.romanizedText ?? item.RomanizedText ?? "");
    }
  }

  dumpRomanizedLyrics(romanizedDump);
}
