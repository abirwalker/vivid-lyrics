import type { TransformedLyrics } from "../lyrics/types";
import { get } from "../stores/settings";
import { getRomanize } from "../stores/romanize";
import {
  setCachedStyle,
  setCachedInline,
  clearCachedStyle,
} from "../utils/style-cache";
import SimpleBar from "simplebar";
import "simplebar/dist/simplebar.css";
import { SmoothLyricsScroller } from "./smooth-scroller";
import { renderLoop, type SharedFrame } from "./render-loop";
import {
  createSpringSet,
  createLetterSpringSet,
  setSpringGoals,
  stepSprings,
  applySpringStyles,
  isEmphasized,
  getActiveSplines,
  Spring,
  createDotSpringSet,
  setDotSpringGoals,
  stepDotSprings,
  DotScaleSpline,
  DotYOffsetSpline,
  DotGlowSpline,
  DotOpacitySpline,
  type SpringSet,
  type SpicySpringConfig,
  type DotSpringSet,
} from "./spicy-spring";
import {
  createWobbleState,
  updateSmoothPosition,
  ensurePrecompute,
  animateWobbleLine,
  snapWobbleToIdle,
  invalidateWobbleRowCache,
  type WobbleLineState,
  type WobbleCharEl,
  type WobbleWord,
} from "./wobble";

const EMPHASIS_LONGER_THAN_MS = 1500;
const INTERLUDE_GAP_THRESHOLD_S = 3;
const INTERLUDE_EARLIER_BY = 0;
/** How many lines on each side of the current playback position keep their full
 * word/syllable/letter DOM mounted. Everything further away is swapped for a
 * cheap placeholder — mirrors spicy-lyrics' virtualizer, just scoped to the
 * expensive inner content instead of the whole line. */
const VIRTUALIZATION_WINDOW = 7;

type LyricState = "Idle" | "Active" | "Sung";

type LetterInfo = {
  span: HTMLSpanElement;
  startScale: number;
  endScale: number;
  springs: SpringSet | null;
};

type SyllableInfo = {
  span: HTMLSpanElement;
  startScale: number;
  endScale: number;
  springs: SpringSet | null;
  emphasized: boolean;
  letters: LetterInfo[];
};

type DotInfo = {
  span: HTMLSpanElement;
  startTime: number;
  endTime: number;
  duration: number;
  springs: DotSpringSet;
};

type LineInfo = {
  container: HTMLButtonElement;
  vocals: HTMLDivElement;
  startTime: number;
  endTime: number;
  duration: number;
  state: LyricState;
  syllables: SyllableInfo[];
  isSyllableType: boolean;
  glowSpring: Spring | null;
  dots?: DotInfo[];
  /** After Active→Sung transition, springs ease out then this flips true to stop processing */
  settled: boolean;
  /** Cached layout positions — computed once after DOM insertion, never read from live DOM during animation */
  cachedOffsetTop: number;
  cachedHeight: number;
  /** Cached reference to the ".Lyric.Synced" span for line-synced lines — resolved once at build time, never queried per frame */
  lyricSpanCache: HTMLElement | null;
  /** Virtualization state for syllable-type lines only (word/syllable/letter trees are
   * expensive — hundreds/thousands of nodes for a full song). When `mounted` is false,
   * the detailed DOM lives detached inside `detailedFragment` and `vocals` shows a
   * cheap `placeholder` span instead, height-locked to `cachedHeight` so scroll math
   * never drifts. Non-syllable lines are never virtualized and always have `mounted: true`. */
  mounted: boolean;
  detailedFragment: DocumentFragment | null;
  placeholder: HTMLElement | null;
  /** Wobble-mode state: smooth position tracker + precomputed line data */
  wobbleState: WobbleLineState | null;
  /** Wobble-mode: ordered list of character spans with their line-text index */
  wobbleChars: WobbleCharEl[] | null;
  /** Wobble-mode: words reconstructed from syllable groups for the wobble engine */
  wobbleWords: WobbleWord[] | null;
};

/** Per-frame settings + spline snapshot — read once, passed everywhere */
type FrameCtx = {
  animationStyle: "spicy-bounce" | "wobble";
  glowIntensity: number;
  blurEnabled: boolean;
  blurStrengthMul: number;
  splines: ReturnType<typeof getActiveSplines>;
};

const USER_SCROLL_RESUME_MS = 3000;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// A spring's frequency/damping is tuned to look right at "normal" syllable/letter
// speed. When a syllable or letter is much shorter than that (fast words), its own
// goal sweeps from NotSung to Sung faster than the spring can physically travel,
// so the glow/bounce gets clipped to a fraction of its intended peak instead of
// just playing out quicker. Rather than changing the spring's tuning (which would
// change how normal-speed syllables look), we feed it a proportionally larger
// deltaTime only when the event is shorter than SPRING_REFERENCE_DURATION_S, so it
// can still reach the same visual peak in the time available. Normal/slow
// syllables get a factor of 1 (completely unaffected).
const SPRING_REFERENCE_DURATION_S = 0.25;
const MAX_SPRING_TIME_SCALE = 6;

function springTimeScale(eventDurationS: number): number {
  if (eventDurationS <= 0) return MAX_SPRING_TIME_SCALE;
  return clamp(
    SPRING_REFERENCE_DURATION_S / eventDurationS,
    1,
    MAX_SPRING_TIME_SCALE,
  );
}

// GPU promotion — only for elements with frequent transform changes (active line dots)
// NOT for syllable/letter spans — those create hundreds of compositor layers and balloon GPU memory
const _gpuPromoted = new WeakSet<HTMLElement>();
function promoteToGPU(el: HTMLElement): void {
  if (_gpuPromoted.has(el)) return;
  el.style.willChange = "transform";
  el.style.backfaceVisibility = "hidden";
  _gpuPromoted.add(el);
}
function demoteFromGPU(el: HTMLElement): void {
  if (!_gpuPromoted.has(el)) return;
  el.style.willChange = "";
  el.style.backfaceVisibility = "";
  _gpuPromoted.delete(el);
}

export default class LyricsRenderer {
  private scrollContainer: HTMLDivElement;
  private lyricsContainer: HTMLDivElement;
  private lines: LineInfo[] = [];
  private unregisterFrame: (() => void) | null = null;
  private lastTimestamp = -1;
  private destroyed = false;
  private lyricsEnded = false;
  private lastActiveIdx = -1;
  private needsScroll = false;
  private scrollPending = false;
  private lastBlurCleared = false;
  private cachedContainerHeight = 0;
  private cachedMaxScroll = 0;
  // Snapshotted once per frame (before any DOM mutation happens that frame)
  // so isLineNearViewport can check dozens of lines without re-reading
  // scrollTop live each time — a live read after this frame's virtualization
  // mount/unmount would force a synchronous layout flush.
  private frameScrollTop = 0;
  /** Index of the line the virtualization window is currently centered on. */
  private referenceLineIndex = -1;

	private autoScrollBlocked = false;
	private programmaticScroll = false;
	private userScrollTimer: ReturnType<typeof setTimeout> | null = null;

  private simpleBar: SimpleBar | null = null;
  private scroller: SmoothLyricsScroller | null = null;
  private blurMap: number[];
  private viewMode: "main" | "card";
  private cardScrollMode: "static" | "gentle" | "active";
  private resizeObserver: ResizeObserver | null = null;
  constructor(
    parentContainer: HTMLElement,
    private lyrics: TransformedLyrics,
    blurMap?: number[],
    viewMode: "main" | "card" = "main",
    cardScrollMode: "static" | "gentle" | "active" = "static",
  ) {
    this.viewMode = viewMode;
    this.cardScrollMode = cardScrollMode;
    this.blurMap = blurMap ?? [0, 0, 0.5, 1, 1.5, 2];
    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "LyricsScrollContainer";

    this.lyricsContainer = document.createElement("div");
    this.lyricsContainer.className = "Lyrics";
    this.scrollContainer.appendChild(this.lyricsContainer);

    this.applyFontSize();
    this.buildLines();
    parentContainer.appendChild(this.scrollContainer);

    this.simpleBar = new SimpleBar(this.scrollContainer, { autoHide: false });
    this.lyricsContainer.style.paddingBottom = "3em";
    this.cacheLayoutPositions();

    if (lyrics.type !== "Static") {
      const initialTimestamp = (Spicetify.Player.getProgress?.() ?? 0) / 1000;
      this.applyVirtualizationWindow(
        this.computeReferenceIndex(initialTimestamp),
      );
    }

    const useScroller =
      (viewMode === "main" && get("scrollMode") === "smooth") ||
      (viewMode === "card" && cardScrollMode === "active");

    if (useScroller) {
      this.scroller = new SmoothLyricsScroller({
        simpleBar: this.simpleBar,
        track: this.lyricsContainer,
        focusRatio: viewMode === "card" ? 0.35 : 0.35,
        mode: "spring",
        stiffness: 180,
        damping: 20,
      });
    }

    this.watchUserScroll();

    // A wobble line's row cache (§ensureRowCache in wobble.ts) is measured
    // once and memoized. If this container's width ever changes while a
    // line is actively playing — window resize, sidebar/queue panel
    // toggling, view mode changes, anything that reflows the lyric text —
    // the cached row assignment goes stale and would otherwise stay wrong
    // for the rest of that line's playthrough, since nothing else
    // invalidates it. Any resize forces every line's cache to rebuild on
    // its next active frame.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.invalidateAllWobbleRowCaches();
      });
      this.resizeObserver.observe(this.scrollContainer);
    }

    if (lyrics.type !== "Static") {
      this.unregisterFrame = renderLoop.register((frame) => {
        this.onFrame(frame);
        return this.isActive();
      });
    }
  }

  private invalidateAllWobbleRowCaches(): void {
    for (const line of this.lines) {
      if (line.wobbleState) invalidateWobbleRowCache(line.wobbleState);
    }
  }

  private applyFontSize(): void {
    const scale = get("fontSize") / 100;
    this.scrollContainer.style.setProperty("--vl-font-size", String(scale));
    const dir = get("gradientDirection");
    this.scrollContainer.style.setProperty(
      "--gradient-degrees",
      dir === "horizontal" ? "90deg" : "180deg",
    );
  }

  private insertDynamicInterludes(content: any[]): any[] {
    const result: any[] = [];
    for (let i = 0; i < content.length; i++) {
      const item = content[i];
      if (item.Type === "Interlude") {
        result.push(item);
        continue;
      }
      const currStart = item.StartTime ?? item.Lead?.StartTime ?? 0;
      // Intro gap before first line
      if (result.length === 0) {
        if (currStart >= INTERLUDE_GAP_THRESHOLD_S) {
          result.push({
            Type: "Interlude",
            StartTime: 0 + INTERLUDE_EARLIER_BY,
            EndTime: currStart + INTERLUDE_EARLIER_BY,
            TotalTime: currStart,
          });
        }
      } else {
        const prev = result[result.length - 1];
        if (prev.Type !== "Interlude") {
          const prevEnd = prev.EndTime ?? prev.Lead?.EndTime ?? 0;
          const gap = currStart - prevEnd;
          if (gap >= INTERLUDE_GAP_THRESHOLD_S) {
            result.push({
              Type: "Interlude",
              StartTime: prevEnd + INTERLUDE_EARLIER_BY,
              EndTime: currStart + INTERLUDE_EARLIER_BY,
              TotalTime: gap,
            });
          }
        }
      }
      result.push(item);
    }
    return result;
  }

  private buildLines(): void {
    const showRomanized = getRomanize();
    // Every syllable is split into per-letter spans unconditionally (not
    // gated on the current animationStyle). buildLines() only runs once,
    // at construction, so baking the DOM structure to whatever mode was
    // active *at that moment* meant switching modes live (without a full
    // remount) left the DOM out of sync with the per-frame animation logic
    // (which reads the live setting every frame in render-loop.ts). That
    // desync is what caused wobble's char-progress to be all-or-nothing
    // after a mode switch, and — the other direction — bounce mode giving
    // every syllable its own per-letter spring bounce/glow instead of only
    // emphasized ones.
    //
    // Splitting is now permanent and mode-independent; only the *spring*
    // (scale/glow bounce) is exclusive to emphasized syllables — see the
    // `emphasized` check below, which leaves `springs: null` on the letters
    // of non-emphasized syllables. Every animation site in this file already
    // gates its per-letter spring application on `ltr.springs` being
    // truthy, so non-emphasized syllables naturally get no bounce, just the
    // (harmless, desired) per-letter --char-progress sweep.
    if (this.lyrics.type === "Static") {
      for (const line of this.lyrics.lines) {
        const group = document.createElement("div");
        group.className = "VocalsGroup";
        const vocals = document.createElement("div");
        vocals.className = "Vocals Lead Active";
        const span = document.createElement("span");
        span.className = "Lyric Static";
        span.textContent = showRomanized ? (line.romanizedText ?? line.text) : line.text;
        vocals.appendChild(span);
        group.appendChild(vocals);
        this.lyricsContainer.appendChild(group);
      }
      return;
    }

    let content = (this.lyrics as any).content ?? [];
    content = this.insertDynamicInterludes(content);
    for (const item of content) {
      const group = document.createElement("button");
      group.className = "VocalsGroup";

      if (item.Type === "Interlude") {
        group.classList.add("InterludeLine");
        const interlude = document.createElement("div");
        interlude.className = "Interlude";
        const dotGroup = document.createElement("div");
        dotGroup.className = "dotGroup";
        const itemStart = item.StartTime ?? 0;
        const itemEnd = item.EndTime ?? 0;
        const totalTime = item.TotalTime ?? itemEnd - itemStart;
        const dotDuration = totalTime / 3;
        const dots: DotInfo[] = [];
        for (let d = 0; d < 3; d++) {
          const dot = document.createElement("span");
          dot.className = "dot";
          promoteToGPU(dot);
          const dtStart = itemStart + dotDuration * d;
          const dtEnd = d < 2 ? itemStart + dotDuration * (d + 1) : itemEnd;
          dot.addEventListener("click", (e) => {
            if (!get("wordSeekEnabled")) return;
            e.stopPropagation();
            Spicetify.Player.seek(dtStart * 1000);
          });
          dotGroup.appendChild(dot);
          dots.push({
            span: dot,
            startTime: dtStart,
            endTime: dtEnd,
            duration: dtEnd - dtStart,
            springs: createDotSpringSet(),
          });
        }
        interlude.appendChild(dotGroup);
        group.appendChild(interlude);
        this.lyricsContainer.appendChild(group);
        this.lines.push({
          container: group,
          vocals: interlude as any,
          startTime: itemStart,
          endTime: itemEnd,
          duration: itemEnd - itemStart,
          state: "Idle",
          syllables: [],
          isSyllableType: false,
          glowSpring: null,
          dots,
          settled: false,
          cachedOffsetTop: 0,
          cachedHeight: 0,
          lyricSpanCache: null,
          mounted: true,
          detailedFragment: null,
          placeholder: null,
          wobbleState: null,
          wobbleChars: null,
          wobbleWords: null,
        });
        continue;
      }

      const startTime = (item.StartTime ?? item.Lead?.StartTime ?? 0) as number;
      const endTime = (item.EndTime ?? item.Lead?.EndTime ?? 0) as number;
      const duration = endTime - startTime;

      const vocals = document.createElement("div");
      vocals.className = "Vocals Lead";

      const syllableData: SyllableInfo[] = [];
      const isSyllableType = !!item.Lead?.Syllables?.length;

      if (isSyllableType) {
        const syllables: any[] = item.Lead.Syllables;

        const words: any[][] = [];
        let currentWord: any[] | null = null;
        for (let i = 0; i < syllables.length; i++) {
          const isFirstInWord = i === 0 || !syllables[i - 1].IsPartOfWord;
          if (isFirstInWord) {
            currentWord = [syllables[i]];
            words.push(currentWord);
          } else if (currentWord) {
            currentWord.push(syllables[i]);
          }
        }

        for (let w = 0; w < words.length; w++) {
          const wordSyllables = words[w];

          const wordSpan = document.createElement("span");
          wordSpan.className = "Word";

          for (const s of wordSyllables) {
            const sStartTime = s.StartTime ?? startTime;
            const sEndTime = s.EndTime ?? endTime;
            const sDuration = sEndTime - sStartTime;
            const text = showRomanized ? (s.RomanizedText ?? s.romanizedText ?? s.Text ?? "") : (s.Text ?? "");
            const textLen = text.length;
            const emphasized = isEmphasized(sDuration, textLen);

            const span = document.createElement("span");
            span.className = s.IsPartOfWord ? "Syllable PartOfWord" : "Syllable";
            span.addEventListener("click", (e) => {
              if (!get("wordSeekEnabled")) return;
              e.stopPropagation();
              Spicetify.Player.seek(sStartTime * 1000);
            });

            const letters: LetterInfo[] = [];

            if (textLen > 0) {
              const lettersArr = [...text];
              const letterDuration = sDuration / lettersArr.length;

              for (let i = 0; i < lettersArr.length; i++) {
                const letterSpan = document.createElement("span");
                letterSpan.className = "Letter";
                letterSpan.textContent = lettersArr[i];
                span.appendChild(letterSpan);

                const letterStart = sStartTime + i * letterDuration;
                const letterEnd = letterStart + letterDuration;

                // Only emphasized syllables get a spring + seeded rest pose.
                // Non-emphasized letters are left with no inline
                // scale/transform at all, so they render at a flat 1:1 and
                // never receive the per-letter bounce/glow spring — only
                // the containing .Syllable's own spring (whole-word bounce)
                // and the per-letter --char-progress sweep apply to them.
                let ltrSprings: ReturnType<typeof createLetterSpringSet> | null = null;
                if (emphasized) {
                  ltrSprings = createLetterSpringSet();
                  const restSplines = getActiveSplines();
                  setCachedInline(
                    letterSpan,
                    "scale",
                    `${restSplines.LetterScale.at(0)}`,
                  );
                  setCachedInline(
                    letterSpan,
                    "transform",
                    `translate3d(0, calc(var(--vl-default-font-size) * ${restSplines.LetterYOffset.at(0) * 2}), 0)`,
                  );
                }

                letters.push({
                  span: letterSpan,
                  startScale: (letterStart - startTime) / (duration || 1),
                  endScale: (letterEnd - startTime) / (duration || 1),
                  springs: ltrSprings,
                });
              }
            }

            wordSpan.appendChild(span);

            // Seed the DOM with the spring's actual resting position (splines
            // start below 1, e.g. 0.95) *before* this line ever animates.
            // Otherwise the span's scale stays unset (visually 100%) until the
            // line first goes Active, and the very first spring-driven write
            // jumps it straight to ~0.95 in one frame — a visible snap that
            // only happens once per line, the first time it's sung.
            const sylSprings = createSpringSet();
            const restSplines = getActiveSplines();
            applySpringStyles(span, {
              scale: restSplines.Scale.at(0),
              yOffset: restSplines.YOffset.at(0),
              glow: restSplines.Glow.at(0),
            });

            syllableData.push({
              span,
              startScale: (sStartTime - startTime) / (duration || 1),
              endScale: (sEndTime - startTime) / (duration || 1),
              springs: sylSprings,
              emphasized,
              letters,
            });
          }

          vocals.appendChild(wordSpan);
        }
      } else {
        const text = showRomanized ? (item.RomanizedText ?? item.romanizedText ?? item.Text ?? "") : (item.Text ?? "");
        if (!text) continue;
        const span = document.createElement("span");
        span.className = "Lyric Synced Line";
        span.textContent = text;
        vocals.appendChild(span);
        group.classList.add("LineSynced");
      }

      const lyricSpanCache = isSyllableType
        ? null
        : (vocals.querySelector(".Lyric.Synced") as HTMLElement | null);

      // Placeholder used when this line's detailed word/syllable/letter tree is
      // virtualized out (see LyricsRenderer.applyVirtualizationWindow). Built now
      // but not swapped in yet — buildLines() leaves every line fully mounted so
      // cacheLayoutPositions() measures real heights; initial virtualization runs
      // once after that.
      let placeholder: HTMLElement | null = null;
      if (isSyllableType) {
        // Mirror the real markup's word grouping (and `.Word` spacing class) so
        // the placeholder wraps at the same points as the detailed content —
        // otherwise its cached height could drift from what's actually rendered.
        // A plain concatenated string here would also run every word together
        // with no spaces ("Giveupthefight") since syllable text has none.
        placeholder = document.createElement("span");
        placeholder.className = "VL-LinePlaceholder";
        const placeholderSyllables: any[] = item.Lead.Syllables;
        let placeholderWord: HTMLSpanElement | null = null;
        for (let i = 0; i < placeholderSyllables.length; i++) {
          const isFirstInWord =
            i === 0 || !placeholderSyllables[i - 1].IsPartOfWord;
          if (isFirstInWord || !placeholderWord) {
            placeholderWord = document.createElement("span");
            placeholderWord.className = "Word";
            placeholder.appendChild(placeholderWord);
          }
          placeholderWord.textContent += placeholderSyllables[i].Text ?? "";
        }
      }

      group.appendChild(vocals);

      const startTimeCopy = startTime;
      group.addEventListener("click", () => {
        Spicetify.Player.seek(startTimeCopy * 1000);
        renderLoop.ensureRunning();
      });

      this.lyricsContainer.appendChild(group);

      // Build wobble data for this line
      let wobbleChars: WobbleCharEl[] | null = null;
      let wobbleWords: WobbleWord[] | null = null;
      let wobbleState: WobbleLineState | null = null;
      if (isSyllableType && syllableData.length > 0) {
        // Reconstruct words from syllable groups (mirrors the words[] loop above)
        const wWords: WobbleWord[] = [];
        let wCurrentWord: SyllableInfo[] | null = null;
        for (let i = 0; i < syllableData.length; i++) {
          const syllables: any[] = item.Lead.Syllables;
          const isFirstInWord = i === 0 || !syllables[i - 1].IsPartOfWord;
          if (isFirstInWord) {
            wCurrentWord = [syllableData[i]];
            wWords.push({
              text: syllableData[i].span.textContent ?? "",
              startTime:
                syllableData[i].startScale * duration + startTime,
              endTime:
                syllableData[i].endScale * duration + startTime,
              hasTrailingSpace: true,
              emphasized: syllableData[i].emphasized,
            });
          } else if (wCurrentWord) {
            wCurrentWord.push(syllableData[i]);
            // Update last word's text and end time
            const last = wWords[wWords.length - 1];
            last.text += syllableData[i].span.textContent ?? "";
            last.endTime =
              syllableData[i].endScale * duration + startTime;
            if (syllableData[i].emphasized) last.emphasized = true;
          }
        }
        // Fix trailing spaces: mark last word in each original word group
        if (wWords.length > 0) {
          wWords[wWords.length - 1].hasTrailingSpace = false;
        }
        wobbleWords = wWords;

        // Flatten letters in line-text order
        const flatChars: WobbleCharEl[] = [];
        let charIdx = 0;
        for (const syl of syllableData) {
          if (syl.letters.length > 0) {
            for (const ltr of syl.letters) {
              flatChars.push({ span: ltr.span, charIndex: charIdx });
              charIdx++;
            }
          } else {
            const text = syl.span.textContent ?? "";
            for (let i = 0; i < text.length; i++) {
              flatChars.push({ span: syl.span, charIndex: charIdx });
              charIdx++;
            }
          }
        }
        wobbleChars = flatChars;
        wobbleState = createWobbleState();
        ensurePrecompute(wobbleState, wWords.map((w) => w.text).join(""), wWords);
      }

      this.lines.push({
        container: group,
        vocals,
        startTime,
        endTime,
        duration,
        state: "Idle",
        syllables: syllableData,
        isSyllableType,
        glowSpring: isSyllableType
          ? null
          : new Spring(getActiveSplines().LineGlow.at(0), 1, 0.5),
        settled: false,
        cachedOffsetTop: 0,
        cachedHeight: 0,
        lyricSpanCache,
        mounted: true,
        detailedFragment: null,
        placeholder,
        wobbleState,
        wobbleChars,
        wobbleWords,
      });
    }
  }

  /** Cache layout positions once after DOM insertion. Called once — never during animation. */
  private cacheLayoutPositions(): void {
    const scrollEl = this.simpleBar!.getScrollElement();
    this.cachedContainerHeight = scrollEl.clientHeight;
    this.cachedMaxScroll = Math.max(
      0,
      scrollEl.scrollHeight - scrollEl.clientHeight,
    );
    for (const line of this.lines) {
      line.cachedOffsetTop = line.container.offsetTop;
      line.cachedHeight = line.container.offsetHeight;
    }
  }

  /** Index of the line whose time window contains (or is next after) `timestamp`.
   * Used to center the virtualization window even during interludes/gaps where no
   * line is strictly "Active". */
  private computeReferenceIndex(timestamp: number): number {
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].endTime > timestamp) return i;
    }
    return this.lines.length - 1;
  }

  /** Attach a syllable-type line's detailed word/syllable/letter tree back into
   * `vocals`, replacing the placeholder. Cheap — just moves already-built nodes,
   * no re-render/recreation. */
  private mountLineDetail(line: LineInfo): void {
    if (line.mounted || !line.detailedFragment) return;
    if (line.placeholder && line.placeholder.parentNode === line.vocals) {
      line.vocals.removeChild(line.placeholder);
    }
    line.vocals.appendChild(line.detailedFragment);
    line.vocals.style.minHeight = "";
    line.mounted = true;
  }

  /** Detach a syllable-type line's detailed tree into an in-memory fragment and
   * show a lightweight placeholder instead. `vocals` gets an explicit min-height
   * matching the cached measurement so removing hundreds of nodes never shifts
   * any other line's scroll position. */
  private unmountLineDetail(line: LineInfo): void {
    if (!line.mounted || !line.placeholder) return;
    if (!line.detailedFragment)
      line.detailedFragment = document.createDocumentFragment();
    while (line.vocals.firstChild) {
      line.detailedFragment.appendChild(line.vocals.firstChild);
    }
    line.vocals.style.minHeight = `${line.cachedHeight}px`;
    line.vocals.appendChild(line.placeholder);
    line.mounted = false;
  }

  /** Mount/unmount syllable-type lines' detailed DOM based on distance from
   * `referenceIndex`. Runs every frame but is a no-op unless a line actually
   * crosses the window boundary. */
  private lastVirtualizedRefIndex = -1;
  private applyVirtualizationWindow(referenceIndex: number): void {
    if (referenceIndex === this.lastVirtualizedRefIndex) return;
    this.lastVirtualizedRefIndex = referenceIndex;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line.isSyllableType) continue;
      const withinWindow =
        Math.abs(i - referenceIndex) <= VIRTUALIZATION_WINDOW;
      if (withinWindow && !line.mounted) {
        this.mountLineDetail(line);
      } else if (!withinWindow && line.mounted) {
        this.unmountLineDetail(line);
      }
    }
  }

  private watchUserScroll(): void {
    const scrollEl = this.simpleBar!.getScrollElement();
    scrollEl.addEventListener("scroll", () => this.onUserScroll(), {
      passive: true,
    });
  }

	private onUserScroll(): void {
		if (this.programmaticScroll) return;
		this.autoScrollBlocked = true;
		this.scrollContainer.classList.add("UserScrolling");

    if (this.userScrollTimer) clearTimeout(this.userScrollTimer);
    this.userScrollTimer = setTimeout(() => {
      this.autoScrollBlocked = false;
      this.scrollContainer.classList.remove("UserScrolling");
      this.scrollToActive();
    }, USER_SCROLL_RESUME_MS);
  }

  private onFrame(frame: SharedFrame): void {
    if (this.destroyed) return;

    const currentTimestamp = frame.currentTimestamp;

    // If the loop was stopped because the song ended and now playback
    // has moved backward, re-activate.
    if (this.lyricsEnded && currentTimestamp < ((this.lyrics as any).endTime ?? Infinity)) {
      this.lyricsEnded = false;
    }

    const deltaTime = frame.deltaTime;
    const isPlaying = frame.isPlaying;
    const skipped =
      this.lastTimestamp >= 0 &&
      Math.abs(currentTimestamp - this.lastTimestamp) > 0.5;

    // Read scrollTop before applyVirtualizationWindow can mount/unmount lines
    // below — reading it after a mutation in the same task would force a
    // synchronous layout flush instead of using the browser's normal,
    // already-computed value from the previous frame.
    this.frameScrollTop = this.simpleBar!.getScrollElement().scrollTop;

    // Recenter the mounted-detail window before animating so a newly-active line
    // (including after a big seek) is always mounted before we try to animate it.
    const refIdx = this.computeReferenceIndex(currentTimestamp);
    if (refIdx !== this.lastVirtualizedRefIndex) {
      this.applyVirtualizationWindow(refIdx);
    }

    let hasActive = false;

    for (const line of this.lines) {
      this.animateLine(
        line,
        currentTimestamp,
        deltaTime,
        isPlaying,
        frame.springConfig,
        frame.ctx,
      );
      if (line.state === "Active") hasActive = true;
    }

    this.lyricsEnded =
      currentTimestamp >= ((this.lyrics as any).endTime ?? Infinity);

    if (this.needsScroll) {
      this.needsScroll = false;
      this.scrollToActive();
    }

    this.updateBlur(frame.ctx);

 		if (this.scroller) {
 			this.programmaticScroll = true;
 			if (hasActive) {
 				this.scroller.update(deltaTime);
 			} else if (!this.autoScrollBlocked) {
 				this.scroller.snapToTarget();
 			}
 			this.programmaticScroll = false;
 		}

		if (skipped) {
      this.lyricsEnded = false;
      this.autoScrollBlocked = false;
      this.scrollContainer.classList.remove("UserScrolling");
      this.scrollToActive(true);
      renderLoop.ensureRunning();
    }

    this.lastTimestamp = currentTimestamp;
  }

  /** Snap a line to its initial Idle state — safe because no animation has happened yet */
  private snapToIdle(line: LineInfo): void {
    if (line.wobbleChars && line.wobbleState) {
      snapWobbleToIdle(line.wobbleChars);
    } else if (line.isSyllableType && line.syllables.length > 0) {
      for (const syl of line.syllables) {
        syl.span.style.setProperty("--char-progress", "-20%");
        for (const ltr of syl.letters) {
          ltr.span.style.setProperty("--char-progress", "-20%");
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots) {
        for (const dot of line.dots) {
          dot.span.style.scale = "";
          dot.span.style.transform = "";
          dot.span.style.opacity = "";
        }
      }
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan) {
        lyricSpan.style.setProperty("--line-progress", "0%");
      }
    }
  }

  /** True if a line's cached position is within (or near) the visible scroll window.
   * Used to avoid spending frame time easing springs on lines the user cannot see. */
  private isLineNearViewport(line: LineInfo): boolean {
    const scrollTop = this.frameScrollTop;
    const containerHeight =
      this.cachedContainerHeight || this.simpleBar!.getScrollElement().clientHeight;
    const margin = containerHeight; // one extra viewport of slack above/below
    const top = line.cachedOffsetTop;
    const bottom = top + line.cachedHeight;
    return (
      bottom >= scrollTop - margin &&
      top <= scrollTop + containerHeight + margin
    );
  }

  /** Snap a Sung line straight to its final resting visual state and mark springs
   * as if they'd already settled — used for off-screen lines so we don't spend
   * dozens of frames easing springs the user can never see. Without this, every
   * line that turns Sung while scrolled out of view keeps stepSungLine() running
   * (and stays promoted to GPU) until it happens to settle on its own, and since
   * lines can turn Sung faster than their springs converge, the number of
   * off-screen lines still being animated keeps growing over the course of a song. */
  private finalizeLineSungInstant(line: LineInfo, ctx: FrameCtx): void {
    if (line.wobbleChars) {
      // Wobble: snap all chars to fully-sung state
      for (const ch of line.wobbleChars) {
        setCachedInline(ch.span, "scale", "1");
        setCachedInline(ch.span, "transform", "");
        setCachedStyle(ch.span, "--char-progress", "120%");
        setCachedStyle(ch.span, "--text-shadow-blur-radius", "4px");
        setCachedStyle(ch.span, "--text-shadow-opacity", "0%");
      }
    } else if (line.isSyllableType && line.syllables.length > 0) {
      const scale = ctx.splines.Scale.at(1);
      const yOffset = ctx.splines.YOffset.at(1);
      const glow = ctx.splines.Glow.at(1);
      const letterScale = ctx.splines.LetterScale.at(1);
      const letterYOffset = ctx.splines.LetterYOffset.at(1);
      for (const syl of line.syllables) {
        syl.span.style.setProperty("--char-progress", "120%");
        if (syl.springs) {
          syl.springs.Scale.SetGoal(scale, true);
          syl.springs.YOffset.SetGoal(yOffset, true);
          syl.springs.Glow.SetGoal(glow, true);
          applySpringStyles(
            syl.span,
            { scale, yOffset, glow },
            ctx.glowIntensity,
          );
        }
        for (const ltr of syl.letters) {
          ltr.span.style.setProperty("--char-progress", "120%");
          if (ltr.springs) {
            ltr.springs.Scale.SetGoal(letterScale, true);
            ltr.springs.YOffset.SetGoal(letterYOffset, true);
            ltr.springs.Glow.SetGoal(glow, true);
            setCachedInline(ltr.span, "scale", `${letterScale}`);
            setCachedInline(
              ltr.span,
              "transform",
              `translate3d(0, calc(var(--vl-default-font-size) * ${letterYOffset * 2}), 0)`,
            );
            setCachedStyle(
              ltr.span,
              "--text-shadow-blur-radius",
              `${4 + 12 * glow}px`,
            );
            setCachedStyle(ltr.span, "--text-shadow-opacity", "0%");
          }
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots) {
        const scale = DotScaleSpline.at(1);
        const yOffset = DotYOffsetSpline.at(1);
        const glow = DotGlowSpline.at(1);
        const opacity = DotOpacitySpline.at(1);
        for (const dot of line.dots) {
          setDotSpringGoals(dot.springs, 1, "Sung", true);
          setCachedInline(dot.span, "scale", `${scale}`);
          setCachedInline(
            dot.span,
            "transform",
            `translate3d(0, calc(var(--vl-default-font-size) * ${yOffset}), 0)`,
          );
          setCachedInline(dot.span, "opacity", `${opacity}`);
          setCachedStyle(
            dot.span,
            "--text-shadow-blur-radius",
            `${4 + 6 * glow}px`,
          );
          setCachedStyle(dot.span, "--text-shadow-opacity", `${glow * 90}%`);
        }
      }
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan) {
        lyricSpan.style.setProperty("--line-progress", "100%");
        if (line.glowSpring) {
          line.glowSpring.SetGoal(0, true);
          setCachedStyle(lyricSpan, "--text-shadow-blur-radius", "4px");
          setCachedStyle(lyricSpan, "--text-shadow-opacity", "0%");
        }
      }
    }
  }

  /** Set spring goals to final Sung position — springs will ease there naturally */
  private setSungGoals(line: LineInfo, ctx: FrameCtx): void {
    if (line.wobbleChars) {
      // Wobble: snap all chars to fully-sung state
      for (const ch of line.wobbleChars) {
        setCachedInline(ch.span, "scale", "1");
        setCachedInline(ch.span, "transform", "");
        setCachedStyle(ch.span, "--char-progress", "120%");
        setCachedStyle(ch.span, "--text-shadow-blur-radius", "4px");
        setCachedStyle(ch.span, "--text-shadow-opacity", "0%");
      }
    } else if (line.isSyllableType && line.syllables.length > 0) {
      for (const syl of line.syllables) {
        syl.span.style.setProperty("--char-progress", "120%");
        if (syl.springs) {
          setSpringGoals(syl.springs, 1, "Sung", false);
        }
        for (const ltr of syl.letters) {
          ltr.span.style.setProperty("--char-progress", "120%");
          if (ltr.springs) {
            ltr.springs.Scale.SetGoal(ctx.splines.Scale.at(1), false);
            ltr.springs.YOffset.SetGoal(ctx.splines.YOffset.at(1), false);
            ltr.springs.Glow.SetGoal(ctx.splines.Glow.at(1), false);
          }
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots) {
        for (const dot of line.dots) {
          setDotSpringGoals(dot.springs, 1, "Sung", false);
        }
      }
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan) {
        lyricSpan.style.setProperty("--line-progress", "100%");
        if (line.glowSpring) {
          line.glowSpring.SetGoal(0, false);
        }
      }
    }
  }

  /** Check if all springs on a line have settled (CanSleep) */
  private areSpringsSettled(line: LineInfo): boolean {
    if (line.wobbleChars) return true; // wobble has no springs
    if (line.isSyllableType && line.syllables.length > 0) {
      for (const syl of line.syllables) {
        if (syl.springs) {
          if (
            !syl.springs.Scale.CanSleep() ||
            !syl.springs.YOffset.CanSleep() ||
            !syl.springs.Glow.CanSleep()
          ) {
            return false;
          }
        }
        for (const ltr of syl.letters) {
          if (ltr.springs) {
            if (
              !ltr.springs.Scale.CanSleep() ||
              !ltr.springs.YOffset.CanSleep() ||
              !ltr.springs.Glow.CanSleep()
            ) {
              return false;
            }
          }
        }
      }
    } else if (line.dots) {
      for (const dot of line.dots) {
        if (
          !dot.springs.Scale.CanSleep() ||
          !dot.springs.YOffset.CanSleep() ||
          !dot.springs.Glow.CanSleep() ||
          !dot.springs.Opacity.CanSleep()
        ) {
          return false;
        }
      }
    }
    if (line.glowSpring && !line.glowSpring.CanSleep()) return false;
    return true;
  }

  /** Step springs on a Sung line until they settle, then apply final DOM state */
  private stepSungLine(
    line: LineInfo,
    deltaTime: number,
    springConfig: SpicySpringConfig,
    ctx: FrameCtx,
  ): void {
    if (line.isSyllableType && line.syllables.length > 0) {
      const sylScratch = { scale: 0, yOffset: 0, glow: 0 };
      const ltrScratch = { scale: 0, yOffset: 0, glow: 0 };
      for (const syl of line.syllables) {
        if (springConfig.enabled && syl.springs) {
          const values = stepSprings(syl.springs, deltaTime, sylScratch);
          applySpringStyles(syl.span, values, ctx.glowIntensity);
        }
        for (const ltr of syl.letters) {
          if (springConfig.enabled && ltr.springs) {
            const values = stepSprings(ltr.springs, deltaTime, ltrScratch);
            const gi = ctx.glowIntensity;
            setCachedInline(ltr.span, "scale", `${values.scale}`);
            setCachedInline(
              ltr.span,
              "transform",
              `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset * 2}), 0)`,
            );
            setCachedStyle(
              ltr.span,
              "--text-shadow-blur-radius",
              `${4 + 12 * values.glow * gi}px`,
            );
            setCachedStyle(
              ltr.span,
              "--text-shadow-opacity",
              `${Math.min(values.glow * 185 * gi, 100)}%`,
            );
          }
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots && line.dots.length > 0 && (springConfig.enabled || ctx.animationStyle === "wobble")) {
        const dotScratch = { scale: 0, yOffset: 0, glow: 0, opacity: 0 };
        for (const dot of line.dots) {
          const v = stepDotSprings(dot.springs, deltaTime, dotScratch);
          setCachedInline(dot.span, "scale", `${v.scale}`);
          setCachedInline(
            dot.span,
            "transform",
            `translate3d(0, calc(var(--vl-default-font-size) * ${v.yOffset}), 0)`,
          );
          setCachedInline(dot.span, "opacity", `${v.opacity}`);
          setCachedStyle(
            dot.span,
            "--text-shadow-blur-radius",
            `${4 + 6 * v.glow}px`,
          );
          setCachedStyle(dot.span, "--text-shadow-opacity", `${v.glow * 90}%`);
        }
      }
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan && line.glowSpring && (springConfig.enabled || ctx.animationStyle === "wobble")) {
        const gi = ctx.glowIntensity;
        const currentGlow = line.glowSpring.Step(deltaTime);
        setCachedStyle(
          lyricSpan,
          "--text-shadow-blur-radius",
          `${4 + 8 * currentGlow * gi}px`,
        );
        setCachedStyle(
          lyricSpan,
          "--text-shadow-opacity",
          `${Math.min(currentGlow * 50 * gi, 100)}%`,
        );
      }
    }
  }

  /** Promote line elements to GPU layer for animation.
   * Only elements with real spring-driven transforms are promoted —
   * non-emphasized letters have no springs and never get an inline
   * transform, so giving them `will-change` just wastes a compositor
   * layer for nothing. */
  private promoteLine(line: LineInfo): void {
    if (line.wobbleChars) {
      for (const ch of line.wobbleChars) promoteToGPU(ch.span);
    } else if (line.isSyllableType) {
      for (const syl of line.syllables) {
        promoteToGPU(syl.span);
        for (const ltr of syl.letters) {
          if (ltr.springs) promoteToGPU(ltr.span);
        }
      }
    } else if (line.dots) {
      for (const dot of line.dots) promoteToGPU(dot.span);
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan) promoteToGPU(lyricSpan);
    }
  }

  /** Demote line elements from GPU layer to free compositor memory */
  private demoteLine(line: LineInfo): void {
    if (line.wobbleChars) {
      for (const ch of line.wobbleChars) demoteFromGPU(ch.span);
    } else if (line.isSyllableType) {
      for (const syl of line.syllables) {
        demoteFromGPU(syl.span);
        for (const ltr of syl.letters) {
          if (ltr.springs) demoteFromGPU(ltr.span);
        }
      }
    } else if (line.dots) {
      for (const dot of line.dots) demoteFromGPU(dot.span);
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan) demoteFromGPU(lyricSpan);
    }
  }

  private animateLine(
    line: LineInfo,
    songTimestamp: number,
    deltaTime: number,
    isPlaying: boolean,
    springConfig: SpicySpringConfig,
    ctx: FrameCtx,
  ): void {
    const replacePos = this.lastTimestamp === -1;
    const relativeTime = songTimestamp - line.startTime;
    const pastStart = relativeTime >= 0;
    const beforeEnd = relativeTime <= line.duration;
    const isActive = pastStart && beforeEnd;
    const stateNow: LyricState = isActive
      ? "Active"
      : pastStart
        ? "Sung"
        : "Idle";

    const stateChanged = stateNow !== line.state;

    if (stateChanged) {
      line.state = stateNow;
      line.settled = false;
      this.evaluateClass(line);

      if (stateNow === "Idle") {
        this.snapToIdle(line);
        this.demoteLine(line);
        return;
      }

      if (stateNow === "Sung") {
        if (!this.isLineNearViewport(line)) {
          // Off-screen: skip the multi-frame ease entirely so it can't pile up
          // alongside other off-screen lines still settling.
          this.finalizeLineSungInstant(line, ctx);
          line.settled = true;
          this.demoteLine(line);
          return;
        }
        this.setSungGoals(line, ctx);
      }

      if (stateNow === "Active") {
        this.promoteLine(line);
        this.needsScroll = true;
      }
    }

    // Idle lines: no per-frame work
    if (stateNow === "Idle") return;

    // Virtualized out (detached, cheap placeholder shown instead) — nothing
    // visible to animate until it re-enters the mounted window.
    if (line.isSyllableType && !line.mounted) return;

    // Sung lines: step springs until settled
    if (stateNow === "Sung") {
      if (line.settled) return;
      if (!this.isLineNearViewport(line)) {
        // Scrolled out of view while still easing — finish instantly instead of
        // continuing to spend frame time on springs nobody can see.
        this.finalizeLineSungInstant(line, ctx);
        line.settled = true;
        this.demoteLine(line);
        return;
      }
      if (this.areSpringsSettled(line)) {
        line.settled = true;
        this.demoteLine(line);
        return;
      }
      this.stepSungLine(line, deltaTime, springConfig, ctx);
      return;
    }

    // Active lines: full animation
    const timeScale =
      line.duration > 0 ? clamp(relativeTime / line.duration, 0, 1) : 1;

    // ── Wobble mode: per-character metro-style animation ──
    if (ctx.animationStyle === "wobble" && line.wobbleChars && line.wobbleState && line.wobbleWords) {
      ensurePrecompute(
        line.wobbleState,
        line.wobbleWords.map((w) => w.text).join(""),
        line.wobbleWords,
      );
      updateSmoothPosition(
        line.wobbleState,
        () => songTimestamp * 1000,
        isPlaying,
        0,
      );
      animateWobbleLine(
        line.wobbleState,
        line.wobbleChars,
        line.wobbleState.smoothPosition,
        performance.now(),
        ctx.glowIntensity,
        line.duration * 1000,
        this.scrollContainer.clientWidth,
      );
      return;
    }

    // ── Spicy Bounce mode: spring-based animation ──
    if (line.isSyllableType && line.syllables.length > 0 && line.duration > 0) {
      const activeScratch = { scale: 0, yOffset: 0, glow: 0 };

      for (const syl of line.syllables) {
        const sylDuration = syl.endScale - syl.startScale || 0.01;
        const sylProgress = clamp(
          (timeScale - syl.startScale) / sylDuration,
          0,
          1,
        );

        const pct = -20 + sylProgress * 140;
        setCachedStyle(syl.span, "--char-progress", `${pct}%`);

        // O(n) active letter scan — hoisted out of per-letter loop
        let activeLetterIndex = -1;
        let activeLetterPercentage = 0;
        for (let i = 0; i < syl.letters.length; i++) {
          const other = syl.letters[i];
          const otherDuration = other.endScale - other.startScale || 0.01;
          const otherProg = clamp(
            (timeScale - other.startScale) / otherDuration,
            0,
            1,
          );
          if (otherProg > 0 && otherProg < 1) {
            activeLetterIndex = i;
            activeLetterPercentage = otherProg;
            break;
          }
        }

        for (let li = 0; li < syl.letters.length; li++) {
          const ltr = syl.letters[li];
          const ltrDuration = ltr.endScale - ltr.startScale || 0.01;
          const ltrProgress = clamp(
            (timeScale - ltr.startScale) / ltrDuration,
            0,
            1,
          );

          const ltrPct = -20 + ltrProgress * 140;
          setCachedStyle(ltr.span, "--char-progress", `${ltrPct}%`);

          if (springConfig.enabled && ltr.springs) {
            const sylDurationMs =
              (syl.endScale - syl.startScale) * line.duration * 1000;
            const stretchMultiplier =
              sylDurationMs > EMPHASIS_LONGER_THAN_MS ? 1.103 : 1.09;

            const ltrState =
              ltrProgress > 0 && ltrProgress < 1
                ? "Active"
                : ltrProgress >= 1
                  ? "Sung"
                  : "NotSung";

            let targetScale = ctx.splines.Scale.at(0);
            let targetYOffset = ctx.splines.YOffset.at(0);
            let targetGlow = ctx.splines.Glow.at(0);

            if (activeLetterIndex >= 0) {
              const baseScale =
                ctx.splines.Scale.at(activeLetterPercentage) *
                stretchMultiplier;
              const baseYOffset = ctx.splines.YOffset.at(
                activeLetterPercentage,
              );
              const baseGlow = ctx.splines.Glow.at(activeLetterPercentage);

              const restingScale = ctx.splines.Scale.at(0);
              const restingYOffset = ctx.splines.YOffset.at(0);
              const restingGlow = ctx.splines.Glow.at(0);

              const distance = Math.abs(li - activeLetterIndex);
              const isCurrent = get("springMode") === "current";
              const falloff = Math.max(
                0,
                1 /
                  (1 + (isCurrent ? Math.pow(distance, 2.8) : distance * 0.9)),
              );
              const glowFalloff = Math.max(0, 1 / (1 + distance * 0.9));

              targetScale = restingScale + (baseScale - restingScale) * falloff;
              targetYOffset =
                restingYOffset + (baseYOffset - restingYOffset) * falloff;
              targetGlow = restingGlow + (baseGlow - restingGlow) * glowFalloff;
            } else {
              if (ltrState === "NotSung") {
                targetScale = ctx.splines.Scale.at(0);
                targetYOffset = ctx.splines.YOffset.at(0);
                targetGlow = ctx.splines.Glow.at(0);
              } else if (ltrState === "Sung") {
                targetScale = ctx.splines.Scale.at(1);
                targetYOffset = ctx.splines.YOffset.at(1);
                targetGlow = ctx.splines.Glow.at(1);
              } else {
                targetScale = ctx.splines.Scale.at(ltrProgress);
                targetYOffset = ctx.splines.YOffset.at(ltrProgress);
                targetGlow = ctx.splines.Glow.at(ltrProgress);
              }
            }

            ltr.springs.Scale.SetGoal(targetScale, replacePos);
            ltr.springs.YOffset.SetGoal(targetYOffset, replacePos);
            ltr.springs.Glow.SetGoal(targetGlow, replacePos);

            const ltrDurationS = ltrDuration * line.duration;
            // Only compress time while the letter is actively building up to its
            // peak — once it's Sung (or hasn't started), ease at the spring's
            // natural speed. Otherwise short/fast letters decay so quickly it
            // reads as an instant snap instead of a smooth scale-down.
            const ltrTimeScale =
              ltrState === "Active" ? springTimeScale(ltrDurationS) : 1;
            const ltrDt = deltaTime * ltrTimeScale;
            const values = stepSprings(ltr.springs, ltrDt, activeScratch);
            const gi = ctx.glowIntensity;
            setCachedInline(ltr.span, "scale", `${values.scale}`);
            setCachedInline(
              ltr.span,
              "transform",
              `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset * 2}), 0)`,
            );
            setCachedStyle(
              ltr.span,
              "--text-shadow-blur-radius",
              `${4 + 12 * values.glow * gi}px`,
            );
            setCachedStyle(
              ltr.span,
              "--text-shadow-opacity",
              `${Math.min(values.glow * 185 * gi, 100)}%`,
            );
          }
        }

        if (springConfig.enabled && syl.springs) {
          const sylState =
            sylProgress > 0 && sylProgress < 1
              ? "Active"
              : sylProgress >= 1
                ? "Sung"
                : "NotSung";

          setSpringGoals(syl.springs, sylProgress, sylState, replacePos);
          const sylDurationS = sylDuration * line.duration;
          // Same rule as letters: only compress time on the way up. On the way
          // back down to resting scale, use the spring's natural speed so short
          // words don't snap back instead of easing out.
          const sylTimeScale =
            sylState === "Active" ? springTimeScale(sylDurationS) : 1;
          const sylDt = deltaTime * sylTimeScale;
          const values = stepSprings(syl.springs, sylDt, activeScratch);
          applySpringStyles(syl.span, values, ctx.glowIntensity);
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots && line.dots.length > 0 && (springConfig.enabled || ctx.animationStyle === "wobble")) {
        const activeDotScratch = { scale: 0, yOffset: 0, glow: 0, opacity: 0 };
        for (const dot of line.dots) {
          const dotRelTime = songTimestamp - dot.startTime;
          const dotProgress =
            dot.duration > 0 ? clamp(dotRelTime / dot.duration, 0, 1) : 0;
          const dotPastStart = dotRelTime >= 0;
          const dotBeforeEnd = dotRelTime <= dot.duration;
          const dotState: "NotSung" | "Active" | "Sung" =
            dotPastStart && dotBeforeEnd
              ? "Active"
              : dotPastStart
                ? "Sung"
                : "NotSung";
          setDotSpringGoals(dot.springs, dotProgress, dotState, replacePos);
          const v = stepDotSprings(dot.springs, deltaTime, activeDotScratch);
          setCachedInline(dot.span, "scale", `${v.scale}`);
          setCachedInline(
            dot.span,
            "transform",
            `translate3d(0, calc(var(--vl-default-font-size) * ${v.yOffset}), 0)`,
          );
          setCachedInline(dot.span, "opacity", `${v.opacity}`);
          setCachedStyle(
            dot.span,
            "--text-shadow-blur-radius",
            `${4 + 6 * v.glow}px`,
          );
          setCachedStyle(dot.span, "--text-shadow-opacity", `${v.glow * 90}%`);
        }
      }
      const lyricSpan = line.lyricSpanCache;
      if (lyricSpan && line.duration > 0) {
        const lineProgress = clamp(relativeTime / line.duration, 0, 1);
        const gradientPos = lineProgress * 100;
        setCachedStyle(lyricSpan, "--line-progress", `${gradientPos}%`);

        if ((springConfig.enabled || ctx.animationStyle === "wobble") && line.glowSpring) {
          const gi = ctx.glowIntensity;
          const targetGlow = ctx.splines.LineGlow.at(lineProgress);
          line.glowSpring.SetGoal(targetGlow, replacePos);
          const currentGlow = line.glowSpring.Step(deltaTime);
          setCachedStyle(
            lyricSpan,
            "--text-shadow-blur-radius",
            `${4 + 8 * currentGlow * gi}px`,
          );
          setCachedStyle(
            lyricSpan,
            "--text-shadow-opacity",
            `${Math.min(currentGlow * 50 * gi, 100)}%`,
          );
        }
      }
    }
  }

  private evaluateClass(line: LineInfo): void {
    const c = line.container;
    if (line.state === "Active") {
      c.classList.remove("Sung");
      c.classList.add("Active");
    } else if (line.state === "Sung") {
      c.classList.remove("Active");
      c.classList.add("Sung");
    } else {
      c.classList.remove("Active", "Sung");
    }
  }

  private updateBlur(ctx?: FrameCtx): void {
    if (this.lyrics.type === "Static") return;

    if (!ctx?.blurEnabled) {
      if (this.lastBlurCleared) return;
      this.lastBlurCleared = true;
      for (let i = 0; i < this.lines.length; i++) {
        const line = this.lines[i];
        clearCachedStyle(line.container, "--vl-blur");
        line.container.style.removeProperty("--vl-blur");
        line.container.style.opacity = "";
      }
      return;
    }
    this.lastBlurCleared = false;

    let activeStart = -1;
    let activeEnd = -1;

    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].state === "Active") {
        if (activeStart === -1) activeStart = i;
        activeEnd = i;
      }
    }

    if (activeStart === -1 && this.lastActiveIdx >= 0) {
      activeStart = this.lastActiveIdx;
      activeEnd = this.lastActiveIdx;
    }

    if (activeStart >= 0) {
      this.lastActiveIdx = activeStart;
    }

    const reset = this.autoScrollBlocked;
    const strengthMul = ctx.blurStrengthMul;
    const BLUR_RANGE = 20;

    const blurStart = Math.max(0, (activeStart >= 0 ? activeStart : 0) - BLUR_RANGE);
    const blurEnd = Math.min(this.lines.length, (activeEnd >= 0 ? activeEnd : 0) + BLUR_RANGE + 1);

    // Clear styles on lines outside the blur window
    for (let i = 0; i < blurStart; i++) {
      const line = this.lines[i];
      clearCachedStyle(line.container, "--vl-blur");
      line.container.style.removeProperty("--vl-blur");
      line.container.style.opacity = "";
    }
    for (let i = blurEnd; i < this.lines.length; i++) {
      const line = this.lines[i];
      clearCachedStyle(line.container, "--vl-blur");
      line.container.style.removeProperty("--vl-blur");
      line.container.style.opacity = "";
    }

    for (let i = blurStart; i < blurEnd; i++) {
      const line = this.lines[i];

      if (reset || activeStart === -1) {
        clearCachedStyle(line.container, "--vl-blur");
        line.container.style.removeProperty("--vl-blur");
        line.container.style.opacity = "";
        continue;
      }

      let distance = this.blurMap.length - 1;
      if (i < activeStart) {
        distance = Math.min(activeStart - i, this.blurMap.length - 1);
      } else if (i > activeEnd) {
        distance = Math.min(i - activeEnd, this.blurMap.length - 1);
      } else {
        distance = 0;
      }

      const blurPx = this.blurMap[distance] * strengthMul;
      let opacity = 1;
      if (distance === 1) opacity = 0.9;
      else if (distance === 2) opacity = 0.75;
      else if (distance === 3) opacity = 0.6;
      else if (distance >= 4) opacity = 0.45;

      setCachedStyle(
        line.container,
        "--vl-blur",
        blurPx > 0 ? `${blurPx}px` : "0",
      );
      setCachedInline(line.container, "opacity", `${opacity}`);
    }
  }

	private scrollToActive(instant?: boolean): void {
		if (!get("autoScroll")) return;

		const activeIdx = this.lines.findIndex((l) => l.state === "Active");
		if (activeIdx === this.lastActiveIdx && !instant) return;
		this.lastActiveIdx = activeIdx;

 		if (activeIdx < 0) {
 			const scrollEl = this.simpleBar!.getScrollElement();
 			this.programmaticScroll = true;
 			scrollEl.scrollTop = this.lyricsEnded ? scrollEl.scrollHeight : 0;
 			this.programmaticScroll = false;
 			return;
 		}

		const activeLine = this.lines[activeIdx];

		if (this.scroller) {
			const lineCenter =
				activeLine.cachedOffsetTop + activeLine.cachedHeight / 2;
			this.scroller.setActiveLine(
				lineCenter,
				this.cachedContainerHeight,
				this.cachedMaxScroll,
			);
			if (instant) {
				this.programmaticScroll = true;
				this.scroller.snapToTarget();
				this.programmaticScroll = false;
			}
			return;
		}

		const scrollEl = this.simpleBar!.getScrollElement();
		const containerHeight =
			this.cachedContainerHeight || scrollEl.clientHeight;
		const scrollTop = scrollEl.scrollTop;

		const lineRelativeTop = activeLine.cachedOffsetTop - scrollTop;
		const lineHeight = activeLine.cachedHeight;

		let targetTop: number;
		if (this.viewMode === "card") {
			const zones: Record<
				string,
				{ min: number; max: number; target: number }
			> = {
				static: { min: 0.15, max: 0.7, target: 0.15 },
				gentle: { min: 0.25, max: 0.55, target: 0.25 },
				active: { min: 0.3, max: 0.45, target: 0.25 },
			};
			const z = zones[this.cardScrollMode] ?? zones.static;
			if (
				lineRelativeTop < containerHeight * z.min ||
				lineRelativeTop > containerHeight * z.max
			) {
				targetTop = scrollTop + lineRelativeTop - containerHeight * z.target;
			} else {
				return;
			}
		} else {
			const targetY = containerHeight * 0.4;
			targetTop = scrollTop + lineRelativeTop - targetY + lineHeight / 2;
		}

		this.programmaticScroll = true;
		scrollEl.scrollTop = Math.round(targetTop);
		this.programmaticScroll = false;
	}

  public destroy(): void {
    this.destroyed = true;
    this.unregisterFrame?.();
    this.unregisterFrame = null;
    if (this.userScrollTimer) clearTimeout(this.userScrollTimer);
    this.scroller?.dispose();
    this.simpleBar?.unMount();
    this.simpleBar = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.lines = [];
    this.scrollContainer.remove();
  }

  private isActive(): boolean {
    if (this.destroyed) return false;
    return true;
  }

  public appendCredits(creditsEl: HTMLElement): void {
    this.lyricsContainer.appendChild(creditsEl);
  }
}
