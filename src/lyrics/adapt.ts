import type { TransformedLyrics } from "./types";
import { romanizeJP, tokenizeAndRomanizeFullLine } from "../utils/romanize";

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

export async function fillRomanizedText(lyrics: TransformedLyrics): Promise<void> {
  if (lyrics.romanizedLanguage !== "Japanese") return;

  const t0 = performance.now();

  if (lyrics.type === "Static") {
    for (const line of lyrics.lines) {
      if (!line.romanizedText && line.text) {
        line.romanizedText = await romanizeJP(line.text);
      }
    }
    console.log(`[VividLyrics] fillRomanizedText: ${lyrics.lines.length} static lines in ${Math.round(performance.now() - t0)}ms`);
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
          const { tokenReadings } = await tokenizeAndRomanizeFullLine(fullText);

          let charOffset = 0;
          const charToRomaji: { start: number; end: number; romaji: string }[] = [];
          for (const tr of tokenReadings) {
            const surfaceLen = [...tr.text].length;
            charToRomaji.push({ start: charOffset, end: charOffset + surfaceLen, romaji: tr.romaji });
            charOffset += surfaceLen;
          }

          let syllableOffset = 0;
          let lastTokenStart = -1;
          for (const s of syllables) {
            const sText = s.text ?? s.Text ?? "";
            const sLen = [...sText].length;
            if (sLen === 0) { syllableOffset += sLen; continue; }

            let romaji = "";
            for (const range of charToRomaji) {
              if (range.start < syllableOffset + sLen && range.end > syllableOffset) {
                const tokenLen = range.end - range.start;
                const overlapStart = Math.max(range.start, syllableOffset) - range.start;
                const overlapEnd = Math.min(range.end, syllableOffset + sLen) - range.start;
                const romajiChars = [...range.romaji];
                const rStart = Math.round((overlapStart / tokenLen) * romajiChars.length);
                const rEnd = Math.round((overlapEnd / tokenLen) * romajiChars.length);
                const chunk = romajiChars.slice(rStart, rEnd).join("");
                if (range.start !== lastTokenStart && range.start > 0 && chunk) {
                  romaji += " " + chunk;
                } else {
                  romaji += chunk;
                }
                if (chunk) lastTokenStart = range.start;
              }
            }

            if (romaji) {
              s.romanizedText = romaji;
              s.RomanizedText = romaji;
              romanized++;
            }
            syllableOffset += sLen;
          }
        }
      } else {
        romanized += syllables.length;
      }
      continue;
    }

    // Line type — romanize the whole line
    const text = item.text ?? item.Text ?? "";
    const existing = item.romanizedText ?? item.RomanizedText;
    if (!existing && text) {
      const romaji = await romanizeJP(text);
      item.romanizedText = romaji;
      item.RomanizedText = romaji;
      romanized++;
    }
  }
  console.log(`[VividLyrics] fillRomanizedText: ${content.length} items, ${romanized} romanized in ${Math.round(performance.now() - t0)}ms`);
}
