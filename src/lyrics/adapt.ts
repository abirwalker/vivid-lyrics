import type { TransformedLyrics } from "./types";
import { get } from "../stores/settings";
import { dumpRomanizedLyrics } from "../tools/dump-romanized";
import { romanizeBengali, romanizeCantonese, romanizeChinese, romanizeJP, romanizeKorean } from "./romanize/romanize";
import { romanizeThaiLine } from "./romanize/romanize-th";
import {
  buildKanaWithTokenBoundaries,
  hasRomanizationBoundaryAt,
  kanaToRomaji,
  tokenizeAndReadFullLine,
  type LineCharReading,
  type LineReading,
  type TokenReading,
} from "./romanize/romanize-jp";

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

function romanizedTextFromSyllables(syllables: any[]): string {
  return syllables.map((syllable, index) => {
    const text = (syllable.romanizedText ?? syllable.RomanizedText ?? "").trim();
    if (index === 0) return text;

    const previous = syllables[index - 1];
    const previousText = (previous.romanizedText ?? previous.RomanizedText ?? "").trim();
    const startsWord =
      syllable.RomanizedStartsWord ??
      syllable.romanizedStartsWord ??
      !(previous.IsPartOfWord ?? previous.isPartOfWord);
    return `${startsWord && previousText && text ? " " : ""}${text}`;
  }).join("");
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
    }
    console.log(`[VividLyrics] fillRomanizedText: ${lyrics.lines.length} static lines — ${fromApi} from API, ${fromLindera} via Lindera (${Math.round(performance.now() - t0)}ms)`);
    if (get("romanizedLyricsConsoleDump")) {
      dumpRomanizedLyrics(
        lyrics.lines.map((line) => [line.text, line.romanizedText ?? ""]),
        "Japanese",
      );
    }
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

  if (get("romanizedLyricsConsoleDump")) {
    const dumpLines: Array<[string, string]> = [];
    for (const item of content) {
      if (item.type === "Interlude" || item.Type === "Interlude") {
        dumpLines.push(["", ""]);
        continue;
      }
      const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
      if (syllables.length > 0) {
        dumpLines.push([
          syllables.map((syllable: any) => syllable.text ?? syllable.Text ?? "").join(""),
          romanizedTextFromSyllables(syllables),
        ]);
      } else {
        dumpLines.push([
          item.text ?? item.Text ?? "",
          item.romanizedText ?? item.RomanizedText ?? "",
        ]);
      }
    }
    dumpRomanizedLyrics(dumpLines, "Japanese");
  }
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
    if (get("romanizedLyricsConsoleDump")) {
      dumpRomanizedLyrics(
        lyrics.lines.map((line) => [line.text, line.romanizedText ?? ""]),
        language,
      );
    }
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
  if (get("romanizedLyricsConsoleDump")) {
    const dumpLines: Array<[string, string]> = [];
    for (const item of content) {
      if (item.type === "Interlude" || item.Type === "Interlude") {
        dumpLines.push(["", ""]);
        continue;
      }
      const syllables = item.Lead?.Syllables ?? item.lead?.syllables ?? [];
      if (syllables.length > 0) {
        dumpLines.push([
          syllables.map((syllable: any) => syllable.text ?? syllable.Text ?? "").join(""),
          romanizedTextFromSyllables(syllables),
        ]);
      } else {
        dumpLines.push([
          item.text ?? item.Text ?? "",
          item.romanizedText ?? item.RomanizedText ?? "",
        ]);
      }
    }
    dumpRomanizedLyrics(dumpLines, language);
  }
}
