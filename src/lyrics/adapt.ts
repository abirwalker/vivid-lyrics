import type { TransformedLyrics } from "./types";

const RTL_LANGS = ["ara", "ar", "heb", "he", "fas", "fa", "urd", "ur"];

const KANA = /[\u3040-\u309F\u30A0-\u30FF]/;
const HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const CJK = /[\u4E00-\u9FFF]/;

function toRomanizedLanguage(lang?: string): TransformedLyrics["romanizedLanguage"] {
  if (!lang) return undefined;
  if (lang === "jpn" || lang === "ja") return "Japanese";
  if (lang === "cmn" || lang === "zh") return "Chinese";
  if (lang === "kor" || lang === "ko") return "Korean";
  return undefined;
}

function detectLanguage(response: any): TransformedLyrics["romanizedLanguage"] {
  const test = (t: string) => {
    if (KANA.test(t)) return "Japanese" as const;
    if (HANGUL.test(t)) return "Korean" as const;
    if (CJK.test(t)) return "Chinese" as const;
    return undefined;
  };

  for (const g of response.Content ?? []) {
    if (g.Type !== "Vocal") continue;
    for (const s of g.Lead?.Syllables ?? []) {
      const r = test(s.Text ?? "");
      if (r) return r;
    }
    const r = test(g.Text ?? "");
    if (r) return r;
  }

  for (const l of response.Lines ?? []) {
    const r = test(l.Text ?? "");
    if (r) return r;
  }

  return undefined;
}

function getEndTime(content: any[]): number {
  if (!content?.length) return 0;
  const last = content[content.length - 1];
  if (last.Type === "Vocal" && last.Lead) return last.Lead.EndTime ?? 0;
  return last.EndTime ?? 0;
}

export function adaptLyrics(response: any): TransformedLyrics {
  const lang = response.Language ?? response.LanguageISO2 ?? "und";
  const romanized = response.IncludesRomanization
    ? toRomanizedLanguage(lang)
    : detectLanguage(response);

  const base = {
    naturalAlignment: RTL_LANGS.includes(lang.toLowerCase()) ? "Right" as const : "Left" as const,
    language: lang,
    ...(romanized ? { romanizedLanguage: romanized } : {}),
    ...(response.SongWriters ? { songWriters: response.SongWriters } : {}),
  };

  if (response.Type === "Static") {
    return { ...base, type: "Static", lines: response.Lines ?? [] };
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
