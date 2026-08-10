import { transliterate } from "transliteration";
import { ensureLindera, tokenize, getReading } from "./lindera";

const CJK = /[\u4E00-\u9FFF]/;

export async function romanizeJP(text: string): Promise<string> {
  if (!text) return text;
  try {
    const { toHiragana, kanaToRomaji } = await import("./romanize-jp");
    await ensureLindera();
    const tokens = tokenize(text);
    const kana = tokens.map((t) => {
      const reading = getReading(t);
      return reading ? toHiragana(reading) : t.surface;
    }).join("");
    return await kanaToRomaji(kana);
  } catch (err) {
    console.error("[VividLyrics] romanizeJP error:", err);
    return text;
  }
}

export function romanizeText(text: string): string {
  if (!text) return text;
  if (CJK.test(text)) return text;
  return transliterate(text, { fixChineseSpacing: true });
}
