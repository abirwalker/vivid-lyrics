import {
  ensureLindera,
  tokenize,
  getReading,
  getPos,
  getPosDetail1,
  getBaseForm,
} from "./lindera";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenRelationship =
  | "independent"
  | "prefix"
  | "suffix"
  | "inflection"
  | "connective"
  | "auxiliary"
  | "bound-particle"
  | "dependent-verb";

/** Map morphology to the word-boundary convention used by romaji output. */
export function shouldAttachRomanization(relationship: TokenRelationship): boolean {
  switch (relationship) {
    case "prefix":
    case "suffix":
    case "inflection":
    case "connective":
    case "auxiliary":
    case "bound-particle":
      return true;
    case "dependent-verb":
    case "independent":
      return false;
  }
}

export type TokenReading = {
  text: string;
  pos?: string;
  pos_detail_1?: string;
  base_form?: string;
  /** Populated by tokenizeAndReadFullLine; optional for manual token fixtures. */
  relationshipToPrevious?: TokenRelationship;
};

export interface LineCharReading {
  /** Hiragana reading for this char (identity for non-JP chars) */
  kana: string;
  tokenIndex: number;
}

export interface LineReading {
  /** Per-character kana, one entry per code point of the full text */
  chars: LineCharReading[];
  /** Resolved tokens (surface + POS), index-aligned with chars.tokenIndex */
  tokens: TokenReading[];
}

// ---------------------------------------------------------------------------
// Character classification
// ---------------------------------------------------------------------------

export function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x4e00 && code <= 0x9fcf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    code === 0x3005 // 々 iteration mark
  );
}

export function isHiragana(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return code >= 0x3040 && code <= 0x309f;
}

export function isKatakana(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return code >= 0x30a0 && code <= 0x30ff;
}

export function isKana(ch: string): boolean {
  return isHiragana(ch) || isKatakana(ch);
}

/** Katakana → hiragana (safe for ー, ・, ヽ etc.) */
export function toHiragana(s: string): string {
  return [...s]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : ch;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Wanakana romaji conversion
// ---------------------------------------------------------------------------

let wanakana: any = null;
async function ensureWanakana() {
  if (!wanakana) wanakana = await import("wanakana");
  return wanakana;
}

export async function kanaToRomaji(kana: string): Promise<string> {
  const wk = await ensureWanakana();
  const fn = wk.toRomaji ?? wk.default?.toRomaji;
  return fn ? fn(expandProlongedMark(kana)) : kana;
}

const VOWEL_OF: Record<string, string> = {
  "ぁ": "あ", "あ": "あ", "か": "あ", "が": "あ", "さ": "あ", "ざ": "あ", "た": "あ", "だ": "あ",
  "な": "あ", "は": "あ", "ば": "あ", "ぱ": "あ", "ま": "あ", "や": "あ", "ゃ": "あ", "ら": "あ",
  "わ": "あ", "ゎ": "あ",
  "ぃ": "い", "い": "い", "き": "い", "ぎ": "い", "し": "い", "じ": "い", "ち": "い", "ぢ": "い",
  "に": "い", "ひ": "い", "び": "い", "ぴ": "い", "み": "い", "り": "い",
  "ぅ": "う", "う": "う", "く": "う", "ぐ": "う", "す": "う", "ず": "う", "つ": "う", "づ": "う",
  "ぬ": "う", "ふ": "う", "ぶ": "う", "ぷ": "う", "む": "う", "ゆ": "う", "ゅ": "う", "る": "う",
  "ぇ": "え", "え": "え", "け": "え", "げ": "え", "せ": "え", "ぜ": "え", "て": "え", "で": "え",
  "ね": "え", "へ": "え", "べ": "え", "ぺ": "え", "め": "え", "れ": "え",
  "ぉ": "お", "お": "お", "こ": "お", "ご": "お", "そ": "お", "ぞ": "お", "と": "お", "ど": "お",
  "の": "お", "ほ": "お", "ぼ": "お", "ぽ": "お", "も": "お", "よ": "お", "ょ": "お", "ろ": "お",
};

/** Expand ー to the previous vowel's kana (スケール → スケエール) so wanakana
 *  produces "sukeeru" instead of "suke-ru". */
function expandProlongedMark(kana: string): string {
  let out = "";
  let prev = "";
  for (const ch of kana) {
    if (ch === "ー") {
      out += VOWEL_OF[prev] ?? ch;
    } else {
      out += ch;
      if (isKana(ch)) prev = ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kana normalization — particles and orthographic variants
// ---------------------------------------------------------------------------

export function normalizeTokenKana(surface: string, kana: string, pos?: string): string {
  const h = toHiragana(kana);
  if (pos === "助詞") {
    if (h === "は") return "わ";
    if (h === "を") return "お";
    if (h === "へ") return "え";
  }
  if (pos === "感動詞" && (h === "こんにちは" || h === "こんばんは")) {
    return h.slice(0, -1) + "わ"; // greeting は is etymologically the particle
  }
  return h;
}

// ---------------------------------------------------------------------------
// Surface ↔ kana alignment — per-character readings for a token
// ---------------------------------------------------------------------------

function distributeKana(chunk: string[], n: number): string[] {
  const m = chunk.length;
  if (n <= 0) return [];
  const base = Math.floor(m / n);
  const extra = m % n;
  const out: string[] = [];
  let p = 0;
  for (let k = 0; k < n; k++) {
    const len = base + (k >= n - extra ? 1 : 0);
    out.push(chunk.slice(p, p + len).join(""));
    p += len;
  }
  return out;
}

// ず/づ and じ/ぢ are historically interchangeable; readings often use the
// 無濁 form while surfaces use the 濁 form (e.g. surface 気づい, reading きずい).
const HOMOPHONE_ANCHORS: Record<string, string> = {
  "ず": "[ずづ]",
  "づ": "[ずづ]",
  "じ": "[じぢ]",
  "ぢ": "[じぢ]",
};

export function alignSurfaceToKana(surface: string, kana: string): string[] {
  const chars = [...surface];
  const reading = [...kana];

  const hasKanji = chars.some(isKanji);
  if (!hasKanji) {
    return chars.map((ch, i) => (isKana(ch) ? toHiragana(reading[i] ?? ch) : ch));
  }

  const runs: { start: number; count: number }[] = [];
  let pattern = "^";
  for (let i = 0; i < chars.length; i++) {
    if (isKanji(chars[i])) {
      if (runs.length && runs[runs.length - 1].start + runs[runs.length - 1].count === i) {
        runs[runs.length - 1].count++;
      } else {
        runs.push({ start: i, count: 1 });
        pattern += "(.+)";
      }
    } else if (isKana(chars[i])) {
      const h = toHiragana(chars[i]);
      pattern += HOMOPHONE_ANCHORS[h] ?? h;
    }
  }
  pattern += "$";

  const out: string[] = chars.map((ch) =>
    isKanji(ch) ? "" : isKana(ch) ? toHiragana(ch) : ch,
  );

  const m = new RegExp(pattern).exec(reading.join(""));
  if (m) {
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const split = distributeKana([...m[r + 1]], run.count);
      for (let k = 0; k < run.count; k++) out[run.start + k] = split[k];
    }
    return out;
  }

  let ri = reading.length - 1;
  for (let i = chars.length - 1; i >= 0 && ri >= 0; i--) {
    if (isKana(chars[i]) && out[i] === "") out[i] = toHiragana(reading[ri--]);
  }
  let li = 0;
  for (let i = 0; i < chars.length && li <= ri; i++) {
    if (isKana(chars[i]) && out[i] === "") out[i] = toHiragana(reading[li++]);
  }
  const chunk = reading.slice(li, ri + 1);
  const kanjiSlots: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (isKanji(chars[i])) kanjiSlots.push(i);
  }
  const split = distributeKana(chunk, kanjiSlots.length);
  for (let k = 0; k < kanjiSlots.length; k++) {
    out[kanjiSlots[k]] = split[k] ?? chars[kanjiSlots[k]];
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "") out[i] = chars[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token relationships
// ---------------------------------------------------------------------------

const INFLECTABLE_POS = new Set(["動詞", "形容詞", "助動詞"]);
const OPENING_PUNCTUATION = new Set([
  "「", "『", "（", "［", "｛", "〈", "《", "〔", "【", "｢", "(", "[", "{", "<",
]);

/**
 * Describe the morphological relationship at a token boundary. This is kept
 * separate from presentation policy: a dependent verb is grammatically linked
 * to the previous token, but romanization may still put a space before it.
 */
export function classifyTokenRelationship(
  prev: TokenReading | undefined,
  curr: TokenReading,
): TokenRelationship {
  if (!prev) return "independent";

  if (prev.pos === "接頭辞") return "prefix";

  // Opening brackets attach to the text that follows them. The relationship
  // is expressed at the current boundary, so this checks the previous token.
  if (prev.pos === "補助記号" && OPENING_PUNCTUATION.has(prev.text)) return "prefix";

  // Japanese punctuation should not acquire a space before it: "sore de,".
  // Opening punctuation is handled above so it also avoids a space after it.
  if (curr.pos === "補助記号") return "suffix";
  if (curr.pos === "接尾辞" || curr.pos_detail_1 === "接尾") return "suffix";

  if (curr.pos === "助動詞" && INFLECTABLE_POS.has(prev.pos ?? "")) {
    return "inflection";
  }

  const isConnectiveParticle =
    curr.pos === "助詞" &&
    curr.pos_detail_1 === "接続助詞" &&
    (curr.text === "て" || curr.text === "で" || curr.text === "ば");
  if (isConnectiveParticle && INFLECTABLE_POS.has(prev.pos ?? "")) {
    return "connective";
  }

  // いる is a grammatical helper after the te-form. Use its base form so
  // inflections such as 隠れていた (い → いる) remain one romanized word.
  if (
    curr.pos === "動詞" &&
    curr.base_form === "いる" &&
    prev.pos === "助詞" &&
    prev.pos_detail_1 === "接続助詞" &&
    (prev.text === "て" || prev.text === "で")
  ) {
    return "auxiliary";
  }

  // Negative/desiderative continuative + なる forms one conjugation chain.
  if (
    curr.pos === "動詞" &&
    curr.base_form === "なる" &&
    (prev.text === "なく" || prev.text === "たく")
  ) {
    return "auxiliary";
  }

  if (
    curr.pos === "助詞" &&
    curr.pos_detail_1 === "副助詞" &&
    ((curr.text === "か" && prev.pos === "代名詞") ||
      (curr.text === "きり" && prev.pos === "名詞"))
  ) {
    return "bound-particle";
  }
  if (curr.text === "たり" && INFLECTABLE_POS.has(prev.pos ?? "")) {
    return "bound-particle";
  }

  // UniDic's non-independent verb tag expresses a grammatical dependency, not
  // a romanization word boundary. In particular, stem + lexical verb pairs
  // such as 辿り + つける should remain "tadori tsukeru".
  if (curr.pos === "動詞" && curr.pos_detail_1?.startsWith("非自立")) {
    return "dependent-verb";
  }

  return "independent";
}

export function resolveTokenRelationship(
  prev: TokenReading | undefined,
  curr: TokenReading,
): TokenRelationship {
  return curr.relationshipToPrevious ?? classifyTokenRelationship(prev, curr);
}

/** Build a kana range while preserving token boundaries within a syllable. */
export function buildKanaWithTokenBoundaries(
  chars: LineCharReading[],
  tokens: TokenReading[],
  start: number,
  end: number,
  separator = " ",
): string {
  let seg = "";
  for (let i = start; i < end; i++) {
    const c = chars[i];
    if (!c) break;
    if (i > start) {
      const prevC = chars[i - 1];
      if (c.tokenIndex !== prevC.tokenIndex) {
        const prevTok = tokens[prevC.tokenIndex];
        const currTok = tokens[c.tokenIndex];
        if (
          prevTok &&
          currTok &&
          !shouldAttachRomanization(resolveTokenRelationship(prevTok, currTok))
        ) {
          seg += separator;
        }
      }
    }
    seg += c.kana;
  }
  return seg;
}

/** Build kana while inserting spaces at independent token boundaries. */
export function buildSpacedKana(reading: LineReading): string {
  return buildKanaWithTokenBoundaries(
    reading.chars,
    reading.tokens,
    0,
    reading.chars.length,
  );
}

// ---------------------------------------------------------------------------
// Main pipeline — Lindera tokenization + per-character kana readings
// ---------------------------------------------------------------------------

export async function tokenizeAndReadFullLine(fullText: string): Promise<LineReading | null> {
  try {
    await ensureLindera();
  } catch (e) {
    console.error("[VividLyrics] Lindera init failed:", e);
    return null;
  }

  const tokens = tokenize(fullText);
  const chars: LineCharReading[] = [];
  const outTokens: TokenReading[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const surface = tok.surface ?? "";
    const rawReading = getReading(tok);

    let resolvedKana: string;
    const hasKanji = [...surface].some(isKanji);
    if (!hasKanji) {
      // Pure kana surface — the surface IS the reading. Using the surface
      // (not a dictionary field) also avoids lexeme quirks like で→テ and
      // よう→ヨー (which would romanize as "yoo" instead of "you").
      resolvedKana = toHiragana(surface);
    } else if (rawReading) {
      resolvedKana = toHiragana(rawReading);
    } else {
      resolvedKana = surface;
    }

    const pos = getPos(tok);
    const posDetail1 = getPosDetail1(tok);
    resolvedKana = normalizeTokenKana(surface, resolvedKana, pos);

    const perChar = alignSurfaceToKana(surface, resolvedKana);

    const surfChars = [...surface];
    const tokenIndex = outTokens.length;
    for (let j = 0; j < surfChars.length; j++) {
      chars.push({ kana: perChar[j] ?? surfChars[j], tokenIndex });
    }

    const token = {
      text: surface,
      pos,
      pos_detail_1: posDetail1,
      base_form: getBaseForm(tok),
    };
    outTokens.push({
      ...token,
      relationshipToPrevious: classifyTokenRelationship(outTokens.at(-1), token),
    });
  }

  return { chars, tokens: outTokens };
}
