import { transliterate } from "transliteration";
import { addTraditionalDict, pinyin } from "pinyin-pro";
import TraditionalDict from "@pinyin-pro/data/traditional";
import ToJyutping from "to-jyutping";
import { romanize as koromanize } from "koroman";
import { romanizeBengaliLine } from "./romanize-bn";
import {
  buildSpacedKana,
  kanaToRomaji,
  tokenizeAndReadFullLine,
} from "./romanize-jp";

const CJK = /[\u4E00-\u9FFF]/;

addTraditionalDict(TraditionalDict);

/** Romanize Mandarin Chinese with contextual polyphone handling. */
export function romanizeChinese(text: string): string {
  if (!text) return text;
  return pinyin(text, {
    toneType: "symbol",
    nonZh: "consecutive",
    separator: "-",
    traditional: true,
  });
}

/** Romanize Cantonese using Jyutping, including tone numbers. */
export function romanizeCantonese(text: string): string {
  if (!text) return text;
  return ToJyutping.getJyutpingText(text);
}

const HANGUL_RUN = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]+/g;

/** Romanize Korean (Hangul) with Revised Romanization, including phonological
 * rules (liaison, nasal/lateral assimilation). Only Hangul runs are converted;
 * latin/punctuation pass through untouched. */
export function romanizeKorean(text: string): string {
  if (!text) return text;
  return text.replace(HANGUL_RUN, (run) => koromanize(run));
}

/** Romanize Bengali script with phonetic transliteration. */
export function romanizeBengali(text: string): string {
  return romanizeBengaliLine(text);
}

/** Romanize Japanese with Lindera word boundaries and a kana-only fallback. */
export async function romanizeJP(text: string): Promise<string> {
  if (!text) return text;

  try {
    const reading = await tokenizeAndReadFullLine(text);
    if (!reading) return await romanizeWithoutTokenizer(text);

    const kana = buildSpacedKana(reading);
    const romaji = await kanaToRomaji(kana);
    return romaji || kana;
  } catch (err) {
    console.error("[VividLyrics] romanizeJP error:", err);
    return await romanizeWithoutTokenizer(text);
  }
}

async function romanizeWithoutTokenizer(text: string): Promise<string> {
  try {
    // Wanakana leaves Kanji unchanged, but still converts all kana when the
    // dictionary is unavailable. Particle normalization is not possible here.
    return (await kanaToRomaji(text)) || text;
  } catch (err) {
    console.error("[VividLyrics] kana fallback error:", err);
    return text;
  }
}

export function romanizeText(text: string): string {
  if (!text) return text;
  if (CJK.test(text)) return text;
  return transliterate(text, { fixChineseSpacing: true });
}
