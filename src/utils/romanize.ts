import { transliterate } from "transliteration";
import {
  buildSpacedKana,
  kanaToRomaji,
  tokenizeAndReadFullLine,
} from "./romanize-jp";

const CJK = /[\u4E00-\u9FFF]/;

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
