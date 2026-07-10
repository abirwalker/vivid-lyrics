import { setCachedStyle, setCachedInline } from "../utils/style-cache";
import { makeSpline } from "./spicy-spring";

const WOBBLE_WORDS_AHEAD = 1;

const glowSpline = makeSpline([
  { Time: 0, Value: 0 },
  { Time: 0.15, Value: 1 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 0 },
]);

// ── Types ──────────────────────────────────────────────────────────────────

export interface WobbleWord {
  text: string;
  startTime: number; // seconds
  endTime: number; // seconds
  hasTrailingSpace: boolean;
  emphasized: boolean;
}

export interface WobbleCharEl {
  span: HTMLSpanElement;
  charIndex: number; // index in the full line text
}

interface EffectiveWord {
  text: string;
  startTime: number;
  endTime: number;
  hasTrailingSpace: boolean;
  emphasized: boolean;
}

interface HyphenGroupInfo {
  pos: number;
  groupSize: number;
  isLast: boolean;
  groupStartMs: number;
  groupEndMs: number;
}

interface LinePrecompute {
  effectiveWords: EffectiveWord[];
  effectiveToOriginalIdx: number[];
  wordIdxMap: Int32Array;
  charInWordMap: Int32Array;
  wordLenMap: Int32Array;
  hyphenGroupData: Map<number, HyphenGroupInfo>;
}

interface RowCache {
  /** Visual row index for each char, in the same order as the `chars` array passed in. */
  rowOf: Int32Array;
  rowCount: number;
  /** getBoundingClientRect().width measured once per row-cache build, reused across frames
   *  instead of re-reading layout twice per character every frame. */
  charWidths: Float64Array;
  charCount: number;
  /** Container width used to build this cache; triggers rebuild when it changes. */
  _containerWidth: number;
}

export interface WobbleLineState {
  smoothPosition: number;
  lastPlayerPos: number;
  lastUpdateTime: number;
  precompute: LinePrecompute | null;
  lineText: string;
  /** Which visual (wrapped) row each letter span currently sits on. Rebuilt whenever
   *  the line's char count changes, or on demand via invalidateWobbleRowCache (e.g.
   *  after a container resize that could change wrap points). */
  rowCache: RowCache | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Smooth Position Tracking ───────────────────────────────────────────────

export function createWobbleState(): WobbleLineState {
  return {
    smoothPosition: 0,
    lastPlayerPos: 0,
    lastUpdateTime: 0,
    precompute: null,
    lineText: "",
    rowCache: null,
  };
}

/** Force the row cache to rebuild on the next animate call — call this if the
 *  container width can change under an already-mounted line (e.g. window resize),
 *  since wrap points (and therefore row boundaries) can shift. */
export function invalidateWobbleRowCache(state: WobbleLineState): void {
  state.rowCache = null;
}

function ensureRowCache(
  state: WobbleLineState,
  chars: WobbleCharEl[],
  containerWidth?: number,
): RowCache {
  const existing = state.rowCache;
  // Invalidate on char count change OR container width change (different wrapping).
  if (
    existing &&
    existing.charCount === chars.length &&
    (containerWidth == null || existing._containerWidth === containerWidth)
  ) {
    return existing;
  }

  const rowOf = new Int32Array(chars.length);
  const charWidths = new Float64Array(chars.length);
  let rowTop: number | null = null;
  let rowIdx = -1;

  // Use getBoundingClientRect for reliable visual row detection.
  // offsetTop can fail when the offsetParent is far up the DOM tree
  // (e.g. inside a scroll container with padding), reporting all chars
  // as the same row even when they visually wrap.
  for (let i = 0; i < chars.length; i++) {
    const el = chars[i].span;
    const rect = el.getBoundingClientRect();
    charWidths[i] = rect.width;
    const top = rect.top;
    // 2px tolerance absorbs sub-pixel jitter within the same row.
    if (rowTop === null || Math.abs(top - rowTop) > 2) {
      rowIdx++;
      rowTop = top;
    }
    rowOf[i] = rowIdx;
  }

  const cache: RowCache = { rowOf, rowCount: rowIdx + 1, charWidths, charCount: chars.length, _containerWidth: containerWidth ?? -1 };
  state.rowCache = cache;
  return cache;
}

export function updateSmoothPosition(
  state: WobbleLineState,
  getPlayerPosMs: () => number,
  isPlaying: boolean,
  lyricsOffsetMs: number,
): void {
  const now = performance.now();
  const playerPos = getPlayerPosMs();

  if (playerPos !== state.lastPlayerPos) {
    state.lastPlayerPos = playerPos;
    state.lastUpdateTime = now;
  }

  const elapsed = now - state.lastUpdateTime;
  state.smoothPosition =
    state.lastPlayerPos + lyricsOffsetMs + (isPlaying ? elapsed : 0);
}

// ── Per-line Precompute ────────────────────────────────────────────────────

function splitHyphenatedWords(words: WobbleWord[]): {
  effectiveWords: EffectiveWord[];
  effectiveToOriginalIdx: number[];
} {
  const effectiveWords: EffectiveWord[] = [];
  const effectiveToOriginalIdx: number[] = [];

  words.forEach((word, originalIdx) => {
    const shouldSplit =
      word.text.includes("-") &&
      word.text.length > 1 &&
      (!word.hasTrailingSpace || words.length === 1);

    if (shouldSplit) {
      const segments: string[] = [];
      let start = 0;
      for (let i = 0; i < word.text.length; i++) {
        if (word.text[i] === "-") {
          segments.push(word.text.slice(start, i + 1));
          start = i + 1;
        }
      }
      if (start < word.text.length) segments.push(word.text.slice(start));

      if (segments.length > 1) {
        const totalDuration = word.endTime - word.startTime;
        const segDuration = totalDuration / segments.length;
        segments.forEach((segText, idx) => {
          effectiveWords.push({
            text: segText,
            startTime: word.startTime + idx * segDuration,
            endTime: word.startTime + (idx + 1) * segDuration,
            hasTrailingSpace:
              idx === segments.length - 1 ? word.hasTrailingSpace : false,
            emphasized: word.emphasized,
          });
          effectiveToOriginalIdx.push(originalIdx);
        });
        return;
      }
    }
    effectiveWords.push(word);
    effectiveToOriginalIdx.push(originalIdx);
  });

  return { effectiveWords, effectiveToOriginalIdx };
}

function buildCharToWordMap(
  mainText: string,
  effectiveWords: EffectiveWord[],
): {
  wordIdxMap: Int32Array;
  charInWordMap: Int32Array;
  wordLenMap: Int32Array;
} {
  const n = mainText.length;
  const wordIdxMap = new Int32Array(n).fill(-1);
  const charInWordMap = new Int32Array(n).fill(0);
  const wordLenMap = new Int32Array(n).fill(1);

  let currentPos = 0;
  effectiveWords.forEach((word, wordIdx) => {
    const rawText = word.text;
    const indexInMain = mainText.indexOf(rawText, currentPos);
    if (indexInMain === -1) return;

    for (let i = 0; i < rawText.length; i++) {
      const pos = indexInMain + i;
      wordIdxMap[pos] = wordIdx;
      charInWordMap[pos] = i;
      wordLenMap[pos] = rawText.length;
    }
    const spacePos = indexInMain + rawText.length;
    if (spacePos < n && mainText[spacePos] === " ") {
      wordIdxMap[spacePos] = wordIdx;
      charInWordMap[spacePos] = rawText.length;
      wordLenMap[spacePos] = rawText.length + 1;
    }
    currentPos = indexInMain + rawText.length;
  });

  return { wordIdxMap, charInWordMap, wordLenMap };
}

function buildHyphenGroupData(
  effectiveWords: EffectiveWord[],
): Map<number, HyphenGroupInfo> {
  const map = new Map<number, HyphenGroupInfo>();
  let currentGroup: number[] = [];

  effectiveWords.forEach((word, wordIdx) => {
    currentGroup.push(wordIdx);
    if (!word.text.endsWith("-")) {
      if (currentGroup.length > 1) {
        const groupSize = currentGroup.length;
        const groupStartMs = effectiveWords[currentGroup[0]].startTime * 1000;
        const groupEndMs = word.endTime * 1000;
        currentGroup.forEach((idx, pos) => {
          map.set(idx, {
            pos,
            groupSize,
            isLast: pos === groupSize - 1,
            groupStartMs,
            groupEndMs,
          });
        });
      }
      currentGroup = [];
    }
  });

  return map;
}

function precomputeLine(
  lineText: string,
  words: WobbleWord[],
): LinePrecompute {
  const { effectiveWords, effectiveToOriginalIdx } = splitHyphenatedWords(words);
  const { wordIdxMap, charInWordMap, wordLenMap } = buildCharToWordMap(
    lineText,
    effectiveWords,
  );
  const hyphenGroupData = buildHyphenGroupData(effectiveWords);

  return {
    effectiveWords,
    effectiveToOriginalIdx,
    wordIdxMap,
    charInWordMap,
    wordLenMap,
    hyphenGroupData,
  };
}

// ── Per-frame Computation ──────────────────────────────────────────────────

function computeWordFactors(
  effectiveWords: EffectiveWord[],
  smoothPosition: number,
): { sungFactor: number; word: EffectiveWord; isWordSung: boolean }[] {
  return effectiveWords.map((word) => {
    const wStartMs = word.startTime * 1000;
    const wEndMs = word.endTime * 1000;
    const isWordSung = smoothPosition > wEndMs;
    const isWordActive =
      smoothPosition >= wStartMs && smoothPosition <= wEndMs;
    const sungFactor = isWordSung
      ? 1
      : isWordActive
        ? clamp(
            (smoothPosition - wStartMs) / Math.max(1, wEndMs - wStartMs),
            0,
            1,
          )
        : 0;
    return { sungFactor, word, isWordSung };
  });
}

function computeWordWobbles(
  effectiveWords: EffectiveWord[],
  effectiveToOriginalIdx: number[],
  smoothPosition: number,
): number[] {
  const origWobble = new Map<number, number>();

  effectiveWords.forEach((word, wordIdx) => {
    const origIdx = effectiveToOriginalIdx[wordIdx];
    if (origWobble.has(origIdx)) return;

    const startMs = word.startTime * 1000;
    const t = smoothPosition - startMs;
    let w = 0;
    if (t >= 0 && t <= 750) {
      w = t < 125 ? t / 125 : Math.max(0, 1 - (t - 125) / 625);
    }
    origWobble.set(origIdx, w);
  });

  return effectiveWords.map(
    (_, wordIdx) => origWobble.get(effectiveToOriginalIdx[wordIdx]) ?? 0,
  );
}

function computeCharLp(
  smoothPosition: number,
  wordItem: EffectiveWord | null,
  charInWord: number,
  wordLen: number,
): number {
  if (!wordItem) return 0;
  const sMs = wordItem.startTime * 1000;
  const dur = Math.max(100, wordItem.endTime * 1000 - sMs);
  const wProg = (smoothPosition - sMs) / dur;
  return clamp((wProg - charInWord / wordLen) * wordLen, 0, 1);
}

function computeNudge(
  charLp: number,
  wordItem: EffectiveWord | null,
  sungFactor: number,
  isWordSung: boolean,
): number {
  if (!wordItem || isWordSung || sungFactor <= 0) return 0;
  return 0.038 * Math.sin(charLp * Math.PI) * Math.exp(-3 * charLp);
}

function computeCrescendo(
  groupWord: HyphenGroupInfo,
  sungFactor: number,
  smoothPosition: number,
  decay: number,
  freq: number,
): number {
  const peakScale = 0.06;
  const baseScalePerSegment = 0.012;
  const p = sungFactor;
  const pOut = clamp(
    (smoothPosition - groupWord.groupEndMs) / 600,
    0,
    1,
  );

  if (pOut > 0) {
    const totalAtEnd =
      groupWord.pos * baseScalePerSegment + peakScale;
    return (
      totalAtEnd *
      Math.exp(-decay * pOut) *
      Math.cos(freq * pOut * Math.PI) *
      (1 - pOut)
    );
  }
  if (groupWord.isLast) {
    const base = groupWord.pos * baseScalePerSegment;
    const springPart =
      peakScale *
      (1 -
        Math.exp(-decay * p) *
          Math.cos(freq * p * Math.PI) *
          (1 - p));
    return base + springPart;
  }
  const boost = p > 0 ? 0.02 * (1 - p) : 0;
  return groupWord.pos * baseScalePerSegment + boost;
}

function computeGlow(
  wordItem: EffectiveWord,
  sungFactor: number,
): { alpha: number } | null {
  const v = glowSpline.at(clamp(sungFactor, 0, 1));
  if (v <= 0.01) return null;
  return { alpha: v * 0.15 };
}

// ── Public: Ensure precompute is up to date ────────────────────────────────

export function ensurePrecompute(
  state: WobbleLineState,
  lineText: string,
  words: WobbleWord[],
): void {
  if (state.precompute && state.lineText === lineText) return;
  state.lineText = lineText;
  state.precompute = precomputeLine(lineText, words);
  state.rowCache = null; // char count/positions may have changed — force a rebuild
}

// ── Public: Animate one active line ────────────────────────────────────────
//
// `chars` must be ordered by charIndex (left-to-right through the line text).
// Each WobbleCharEl.span is the `.Letter` element to style.

export function animateWobbleLine(
  state: WobbleLineState,
  chars: WobbleCharEl[],
  smoothPosition: number,
  wallTimeMs: number,
  glowIntensity: number,
  lineDurationMs: number,
  containerWidth?: number,
): void {
  const pc = state.precompute;
  if (!pc || chars.length === 0) return;

  const {
    effectiveWords,
    effectiveToOriginalIdx,
    wordIdxMap,
    charInWordMap,
    wordLenMap,
    hyphenGroupData,
  } = pc;

  const wordFactors = computeWordFactors(effectiveWords, smoothPosition);
  const wordWobbles = computeWordWobbles(
    effectiveWords,
    effectiveToOriginalIdx,
    smoothPosition,
  );

  // Row assignment + cached widths (still used for indexing the per-row push
  // arrays below and avoiding repeated offsetWidth reads).
  const { rowOf, rowCount, charWidths } = ensureRowCache(state, chars, containerWidth);
  // Find which effective word is actually being sung right now, and which
  // visual rows it occupies. The wobble window extends forward only to words
  // that sit on the same visual row(s) as the active word — no fixed word
  // count. This prevents bleed across line-wrap boundaries.
  let activeWordIdx = -1;
  for (let wi = 0; wi < wordFactors.length; wi++) {
    const { sungFactor, isWordSung } = wordFactors[wi];
    if (!isWordSung && sungFactor > 0) {
      activeWordIdx = wi;
      break;
    }
  }
  const activeRows = new Set<number>();
  if (activeWordIdx !== -1) {
    for (let i = 0; i < chars.length; i++) {
      if (wordIdxMap[chars[i].charIndex] === activeWordIdx) {
        activeRows.add(rowOf[i]);
      }
    }
  }

  // Wobble window: the active word plus a HARD cap of WOBBLE_WORDS_AHEAD
  // words following it — never more, no matter how many words remain on
  // the current visual row.
  const lastWordOnActiveRow =
    activeWordIdx !== -1 ? activeWordIdx + WOBBLE_WORDS_AHEAD : -1;

  // Bottom-row freeze: identify the bottom-most visual row and the first
  // word on it. Characters on the bottom row stay completely untouched
  // (no DOM writes at all) until that first word begins singing.
  const bottomRow = rowCount - 1;
  let firstWordOnBottomRow = -1;
  if (bottomRow >= 0) {
    for (let i = 0; i < chars.length; i++) {
      if (rowOf[i] === bottomRow) {
        const wi = wordIdxMap[chars[i].charIndex];
        if (wi !== -1) {
          firstWordOnBottomRow = wi;
          break;
        }
      }
    }
  }

  // ── Pass 1: alignment (X-only, decay=2.5 freq=10.0) ──
  const lineTotalPush = new Float64Array(rowCount);
  const scaleXPass1 = new Float64Array(chars.length);

  for (let i = 0; i < chars.length; i++) {
    const ci = chars[i].charIndex;
    const wi = wordIdxMap[ci];
    if (wi === -1) {
      scaleXPass1[i] = 1;
      continue;
    }

    const row = rowOf[i];
    const wordDistance = activeWordIdx !== -1 ? wi - activeWordIdx : null;
    const isInWobbleWindowPass1 =
      wordDistance !== null &&
      wordDistance >= 0 &&
      wi <= lastWordOnActiveRow &&
      activeRows.has(row);

    // Bottom row freeze: skip alignment pass entirely for frozen chars.
    const isFrozenBottomRowPass1 =
      row === bottomRow &&
      firstWordOnBottomRow !== -1 &&
      activeWordIdx !== -1 &&
      firstWordOnBottomRow > activeWordIdx;

    if (!isInWobbleWindowPass1 || isFrozenBottomRowPass1) {
      scaleXPass1[i] = 1;
      continue;
    }

    const origWi = effectiveToOriginalIdx[wi];
    const wobble = wordWobbles[origWi] || 0;
    const { sungFactor, word: wordItem, isWordSung } = wordFactors[wi];
    const group = hyphenGroupData.get(wi);
    const crescendoX = group
      ? computeCrescendo(group, sungFactor, smoothPosition, 2.5, 10.0)
      : 0;
    const charLp = computeCharLp(
      smoothPosition,
      wordItem,
      charInWordMap[ci],
      wordLenMap[ci],
    );
    const nudge = computeNudge(charLp, wordItem, sungFactor, isWordSung);
    const emphMul = wordItem?.emphasized ? 2 : 1;
    const scaleX =
      1 + wobble * 0.0375 * emphMul + crescendoX + nudge * 0.3;
    scaleXPass1[i] = scaleX;
    lineTotalPush[row] += charWidths[i] * (scaleX - 1) * 1.2;
  }

  // ── Pass 2: draw (X+Y, decay=3.5 freq=5.0) ──
  const lineCurrentPush = new Float64Array(rowCount);

  for (let i = 0; i < chars.length; i++) {
    const ci = chars[i].charIndex;
    const wi = wordIdxMap[ci];
    const origWi = wi !== -1 ? effectiveToOriginalIdx[wi] : -1;
    const wobble = origWi !== -1 ? wordWobbles[origWi] : 0;
    const { sungFactor, word: wordItem, isWordSung } =
      wi !== -1
        ? wordFactors[wi]
        : { sungFactor: 0, word: null as EffectiveWord | null, isWordSung: false };
    const group = wi !== -1 ? hyphenGroupData.get(wi) : null;
    const charLp = computeCharLp(
      smoothPosition,
      wordItem,
      charInWordMap[ci],
      wordLenMap[ci],
    );
    const nudge = computeNudge(charLp, wordItem, sungFactor, isWordSung);

    let crescendoX = 0;
    if (group) {
      crescendoX = computeCrescendo(
        group,
        sungFactor,
        smoothPosition,
        3.5,
        5.0,
      );
    }

    // ── Gate: is this character in the wobble window? ──
    const row = rowOf[i];
    const wordDistance = activeWordIdx !== -1 && wi !== -1 ? wi - activeWordIdx : null;
    const isInWobbleWindow =
      wordDistance !== null &&
      wordDistance >= 0 &&
      wi <= lastWordOnActiveRow &&
      activeRows.has(row);

    // Bottom row freeze: characters on the bottom row stay completely
    // untouched until the first word on that row begins singing.
    const isFrozenBottomRow =
      row === bottomRow &&
      firstWordOnBottomRow !== -1 &&
      activeWordIdx !== -1 &&
      firstWordOnBottomRow > activeWordIdx;

    // Reset chars outside the wobble window or on a frozen bottom row to
    // identity — but only if the word's own wobble has fully decayed.
    // If wobble > 0 the word is still in its natural 750ms decay and will
    // smoothly reach scale 1 on its own; hard-resetting mid-decay snaps.
    if ((!isInWobbleWindow && wobble === 0) || isFrozenBottomRow) {
      setCachedInline(chars[i].span, "scale", "1");
      setCachedInline(chars[i].span, "transform", "");
      continue;
    }

    const emphMul = wordItem?.emphasized ? 2 : 1;
    const scaleX = 1 + wobble * 0.0375 * emphMul + crescendoX + nudge * 0.3;
    const scaleY = 1;
    const waveY = 0;

    const charWidth = charWidths[i];
    const tx = lineCurrentPush[row];
    lineCurrentPush[row] += charWidth * (scaleX - 1) * 1.2;

    const baseAlpha =
      isWordSung || charLp > 0.99
        ? 1
        : 0.3 + 0.7 * sungFactor;

    const pct = -20 + clamp(charLp, 0, 1) * 140;

    let glowAlpha = 0;
    if (wordItem && !isWordSung && sungFactor > 0.001) {
      const glow = computeGlow(wordItem, sungFactor);
      if (glow) {
        glowAlpha = glow.alpha;
      }
    }

    const el = chars[i].span;
    setCachedInline(el, "scale", `${scaleX}`);
    setCachedInline(
      el,
      "transform",
      `translate3d(${tx.toFixed(2)}px, ${waveY.toFixed(2)}px, 0) scaleY(${scaleY.toFixed(4)})`,
    );
    setCachedStyle(
      el,
      "--char-progress",
      `${pct.toFixed(1)}%`,
    );
    setCachedStyle(
      el,
      "--text-shadow-blur-radius",
      `${(4 + 12 * glowAlpha * glowIntensity).toFixed(2)}px`,
    );
    setCachedStyle(
      el,
      "--text-shadow-opacity",
      `${Math.min(glowAlpha * 185 * glowIntensity, 100).toFixed(1)}%`,
    );
  }
}

// ── Public: Snap a wobble line to idle ─────────────────────────────────────

export function snapWobbleToIdle(chars: WobbleCharEl[]): void {
  for (const ch of chars) {
    ch.span.style.scale = "";
    ch.span.style.transform = "";
    setCachedStyle(ch.span, "--char-progress", "-20%");
    setCachedStyle(ch.span, "--text-shadow-blur-radius", "4px");
    setCachedStyle(ch.span, "--text-shadow-opacity", "0%");
  }
}
