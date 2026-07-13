import { setCachedStyle, setCachedInline } from "../utils/style-cache";
import { makeSpline } from "./spicy-spring";

const WOBBLE_WORDS_AHEAD = 1;
// Sustained size bump for emphasized words while they are being sung, so the
// emphasis doesn't collapse the instant the onset pop finishes.
const EMPH_BASE_SCALE = 0.05;

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
  /** Count of original (pre-hyphen-split) words; sizes the origWobble scratch buffer. */
  originalWordCount: number;
}

interface WobbleScratch {
  sungFactor: Float64Array;
  isWordSung: Uint8Array;
  origWobble: Float64Array;
  wordWobble: Float64Array;
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
  /** Reusable per-frame word-factor/wobble buffers. Rebuilt only when word
   *  counts change (see ensureWobbleScratch), not on every frame. */
  scratch: WobbleScratch | null;
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
    scratch: null,
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
    originalWordCount: words.length,
  };
}

// ── Per-frame Computation ──────────────────────────────────────────────────

function ensureWobbleScratch(
  state: WobbleLineState,
  effectiveWordCount: number,
  originalWordCount: number,
): WobbleScratch {
  const existing = state.scratch;
  if (
    existing &&
    existing.sungFactor.length === effectiveWordCount &&
    existing.origWobble.length === originalWordCount
  ) {
    return existing;
  }
  const scratch: WobbleScratch = {
    sungFactor: new Float64Array(effectiveWordCount),
    isWordSung: new Uint8Array(effectiveWordCount),
    origWobble: new Float64Array(originalWordCount),
    wordWobble: new Float64Array(effectiveWordCount),
  };
  state.scratch = scratch;
  return scratch;
}

function fillWordFactors(
  effectiveWords: EffectiveWord[],
  smoothPosition: number,
  sungFactorOut: Float64Array,
  isWordSungOut: Uint8Array,
): void {
  for (let i = 0; i < effectiveWords.length; i++) {
    const word = effectiveWords[i];
    const wStartMs = word.startTime * 1000;
    const wEndMs = word.endTime * 1000;
    const isWordSung = smoothPosition > wEndMs;
    const isWordActive =
      smoothPosition >= wStartMs && smoothPosition <= wEndMs;
    sungFactorOut[i] = isWordSung
      ? 1
      : isWordActive
        ? clamp(
            (smoothPosition - wStartMs) / Math.max(1, wEndMs - wStartMs),
            0,
            1,
          )
        : 0;
    isWordSungOut[i] = isWordSung ? 1 : 0;
  }
}

function fillWordWobbles(
  effectiveWords: EffectiveWord[],
  effectiveToOriginalIdx: number[],
  smoothPosition: number,
  origWobbleScratch: Float64Array,
  wordWobbleOut: Float64Array,
): void {
  origWobbleScratch.fill(-1);
  for (let i = 0; i < effectiveWords.length; i++) {
    const origIdx = effectiveToOriginalIdx[i];
    let w = origWobbleScratch[origIdx];
    if (w < 0) {
      const startMs = effectiveWords[i].startTime * 1000;
      const t = smoothPosition - startMs;
      w = 0;
      if (t >= 0 && t <= 750) {
        w = t < 125 ? t / 125 : Math.max(0, 1 - (t - 125) / 625);
      }
      origWobbleScratch[origIdx] = w;
    }
    wordWobbleOut[i] = w;
  }
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

// Sustained emphasis: a smooth size bump that follows the word's sung
// duration — scales up gently, peaks mid-word, then scales back down smoothly
// (no snap up, no fast fade). Drives a visible push on following words.
// No per-char motion (no wiggle).
function computeEmphOffset(
  wordItem: EffectiveWord | null,
  sungFactor: number,
  isWordSung: boolean,
  _smoothPosition: number,
): number {
  if (!wordItem?.emphasized) return 0;
  // sin(π·t): 0 at word start, peak at mid, 0 at word end — smooth rise+fall
  // spread across the whole duration instead of a sudden pop or fast snap.
  if (sungFactor > 0 && !isWordSung) {
    return EMPH_BASE_SCALE * Math.sin(Math.PI * clamp(sungFactor, 0, 1));
  }
  return 0; // fully sung: envelope is already back at 0
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
  state.scratch = null; // word counts may have changed — force scratch buffers to resize
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
    originalWordCount,
  } = pc;

  const scratch = ensureWobbleScratch(
    state,
    effectiveWords.length,
    originalWordCount,
  );
  fillWordFactors(effectiveWords, smoothPosition, scratch.sungFactor, scratch.isWordSung);
  fillWordWobbles(
    effectiveWords,
    effectiveToOriginalIdx,
    smoothPosition,
    scratch.origWobble,
    scratch.wordWobble,
  );

  // Row assignment + cached widths (still used for indexing the per-row push
  // arrays below and avoiding repeated offsetWidth reads).
  const { rowOf, rowCount, charWidths } = ensureRowCache(state, chars, containerWidth);
  // Find which effective word is actually being sung right now, and which
  // visual row it occupies. The wobble window extends forward only to words
  // that sit on that same visual row — no fixed word count. This prevents
  // bleed across line-wrap boundaries.
  let activeWordIdx = -1;
  for (let wi = 0; wi < effectiveWords.length; wi++) {
    if (!scratch.isWordSung[wi] && scratch.sungFactor[wi] > 0) {
      activeWordIdx = wi;
      break;
    }
  }

  let activeRow = -1;
  if (activeWordIdx !== -1) {
    for (let i = 0; i < chars.length; i++) {
      if (wordIdxMap[chars[i].charIndex] === activeWordIdx) {
        activeRow = rowOf[i];
        break;
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


  const lineCurrentPush = new Float64Array(rowCount);

  for (let i = 0; i < chars.length; i++) {
    const ci = chars[i].charIndex;
    const wi = wordIdxMap[ci];
    const row = rowOf[i];


    const wordDistance = activeWordIdx !== -1 && wi !== -1 ? wi - activeWordIdx : null;
    const isInWobbleWindow =
      wordDistance !== null &&
      wordDistance >= 0 &&
      wi <= lastWordOnActiveRow &&
      row === activeRow;

    // Bottom row freeze: characters on the bottom row stay completely
    // untouched until the first word on that row begins singing.
    const isFrozenBottomRow =
      row === bottomRow &&
      firstWordOnBottomRow !== -1 &&
      activeWordIdx !== -1 &&
      firstWordOnBottomRow > activeWordIdx;

    const wobble = wi !== -1 ? scratch.wordWobble[wi] : 0;

    // ── Frozen bottom row: hard reset (no animation bleeds onto the
    //     invisible last line while earlier words are still active). ──
    if (isFrozenBottomRow) {
      setCachedInline(chars[i].span, "scale", "1");
      setCachedInline(chars[i].span, "transform", "");
      continue;
    }

    if (!isInWobbleWindow && wobble === 0) {
      const tx = lineCurrentPush[row];
      if (tx !== 0) {
        setCachedInline(chars[i].span, "scale", "1");
        setCachedInline(chars[i].span, "transform",
          `translate3d(${tx.toFixed(2)}px, 0, 0) scaleY(1)`);
      } else {
        setCachedInline(chars[i].span, "scale", "1");
        setCachedInline(chars[i].span, "transform", "");
      }
      continue;
    }

    // Only characters that reach here (the active wobble window, plus any
    // still mid-decay after leaving it) pay for the spring math below.
    const sungFactor = wi !== -1 ? scratch.sungFactor[wi] : 0;
    const isWordSung = wi !== -1 ? scratch.isWordSung[wi] === 1 : false;
    const wordItem = wi !== -1 ? effectiveWords[wi] : null;
    const group = wi !== -1 ? hyphenGroupData.get(wi) : undefined;

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

    const emphMul = wordItem?.emphasized ? 2 : 1;
    const emphOffset = computeEmphOffset(
      wordItem,
      sungFactor,
      isWordSung,
      smoothPosition,
    );
    const scaleX = 1 + wobble * 0.0375 * emphMul + crescendoX + nudge * 0.3 + emphOffset;
    const scaleY = 1;
    const waveY = 0;

    const charWidth = charWidths[i];
    const tx = lineCurrentPush[row];
    lineCurrentPush[row] += charWidth * (scaleX - 1) * 1.2;

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
