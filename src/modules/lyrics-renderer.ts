import type { TransformedLyrics } from "../lyrics/types";
import { get } from "../stores/settings";
import { setCachedStyle, setCachedInline, clearCachedStyle } from "../utils/style-cache";
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
  type SpringSet,
  type SpicySpringConfig,
  type DotSpringSet,
} from "./spicy-spring";

const EMPHASIS_LONGER_THAN_MS = 1500;
const INTERLUDE_GAP_THRESHOLD_S = 3;
const INTERLUDE_EARLIER_BY = 0;

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
};

/** Per-frame settings + spline snapshot — read once, passed everywhere */
type FrameCtx = {
  springEnabled: boolean;
  glowIntensity: number;
  blurEnabled: boolean;
  blurStrengthMul: number;
  splines: ReturnType<typeof getActiveSplines>;
};

const USER_SCROLL_RESUME_MS = 3000;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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
  private rafId = 0;
  private lastTimestamp = -1;
  private destroyed = false;
  private lyricsEnded = false;
  private lastActiveIdx = -1;

  private autoScrollBlocked = false;
  private userScrollTimer: ReturnType<typeof setTimeout> | null = null;
  private targetScrollTop = -1;
  private scrollStart = 0;
  private scrollStartTime = 0;
  private scrollDuration = 1;

  private blurMap: number[];
  private viewMode: "main" | "card";
  private cardScrollMode: "static" | "gentle" | "active";
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

    this.watchUserScroll();

    if (lyrics.type !== "Static") {
      this.startLoop();
    }
  }

  private applyFontSize(): void {
    const scale = get("fontSize") / 100;
    this.scrollContainer.style.setProperty("--vl-font-size", String(scale));
    const dir = get("gradientDirection");
    this.scrollContainer.style.setProperty("--gradient-degrees", dir === "horizontal" ? "90deg" : "180deg");
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
    if (this.lyrics.type === "Static") {
      for (const line of this.lyrics.lines) {
        const group = document.createElement("div");
        group.className = "VocalsGroup";
        const vocals = document.createElement("div");
        vocals.className = "Vocals Lead Active";
        const span = document.createElement("span");
        span.className = "Lyric Static";
        span.textContent = line.text;
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
        const totalTime = item.TotalTime ?? (itemEnd - itemStart);
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
        });
        continue;
      }

      const startTime = (item.StartTime ?? item.Lead?.StartTime ?? 0) as number;
      const endTime = (item.EndTime ?? item.Lead?.EndTime ?? 0) as number;
      const duration = endTime - startTime;

      const vocals = document.createElement("div");
      vocals.className = "Vocals Lead";

      const syllableData: SyllableInfo[] = [];
      const isSyllableType = !!(item.Lead?.Syllables?.length);

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
            const text = s.Text ?? "";
            const textLen = text.length;
            const emphasized = isEmphasized(sDuration, textLen);

            const span = document.createElement("span");
            span.className = "Syllable";
            span.addEventListener("click", (e) => {
              if (!get("wordSeekEnabled")) return;
              e.stopPropagation();
              Spicetify.Player.seek(sStartTime * 1000);
            });

            const letters: LetterInfo[] = [];
            const lettersArr = [...text];

            if (textLen > 0) {
              const letterDuration = sDuration / lettersArr.length;

              for (let i = 0; i < lettersArr.length; i++) {
                const letterSpan = document.createElement("span");
                letterSpan.className = "Letter";
                letterSpan.textContent = lettersArr[i];
                span.appendChild(letterSpan);

                const letterStart = sStartTime + i * letterDuration;
                const letterEnd = letterStart + letterDuration;

                letters.push({
                  span: letterSpan,
                  startScale: (letterStart - startTime) / (duration || 1),
                  endScale: (letterEnd - startTime) / (duration || 1),
                  springs: emphasized && textLen > 0 ? createLetterSpringSet() : null,
                });
              }
            }

            wordSpan.appendChild(span);

            syllableData.push({
              span,
              startScale: (sStartTime - startTime) / (duration || 1),
              endScale: (sEndTime - startTime) / (duration || 1),
              springs: createSpringSet(),
              emphasized,
              letters,
            });
          }

          vocals.appendChild(wordSpan);
        }
      } else {
        const text = item.Text ?? "";
        if (!text) continue;
        const span = document.createElement("span");
        span.className = "Lyric Synced Line";
        span.textContent = text;
        vocals.appendChild(span);
        group.classList.add("LineSynced");
      }

      group.appendChild(vocals);

      const startTimeCopy = startTime;
      group.addEventListener("click", () => {
        Spicetify.Player.seek(startTimeCopy * 1000);
      });

      this.lyricsContainer.appendChild(group);

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
      });
    }
  }

  private watchUserScroll(): void {
    this.scrollContainer.addEventListener("wheel", () => this.onUserScroll(), { passive: true });
    this.scrollContainer.addEventListener("touchmove", () => this.onUserScroll(), { passive: true });
  }

  private onUserScroll(): void {
    this.autoScrollBlocked = true;
    this.scrollContainer.classList.add("UserScrolling");

    if (this.userScrollTimer) clearTimeout(this.userScrollTimer);
    this.userScrollTimer = setTimeout(() => {
      this.autoScrollBlocked = false;
      this.scrollContainer.classList.remove("UserScrolling");
      this.scrollToActive();
    }, USER_SCROLL_RESUME_MS);
  }

  private lastFrameTime = 0;

  private startLoop(): void {
    this.lastFrameTime = performance.now();

    const tick = () => {
      if (this.destroyed) return;

      const now = performance.now();
      const deltaTime = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      const currentTimestamp = Spicetify.Player.getProgress() / 1000;
      const skipped =
        this.lastTimestamp >= 0 &&
        Math.abs(currentTimestamp - this.lastTimestamp) > 0.5;

      const springConfig: SpicySpringConfig = {
        enabled: get("springEnabled"),
      };

      const blurStrength = get("blurStrength");
      const ctx: FrameCtx = {
        springEnabled: get("springEnabled"),
        glowIntensity: get("glowIntensity"),
        blurEnabled: get("blurEnabled"),
        blurStrengthMul: blurStrength === "light" ? 0.5 : blurStrength === "heavy" ? 1.5 : 1,
        splines: getActiveSplines(),
      };

      for (const line of this.lines) {
        this.animateLine(line, currentTimestamp, deltaTime, springConfig, ctx);
      }

      this.lyricsEnded = currentTimestamp >= ((this.lyrics as any).endTime ?? Infinity);

      this.updateBlur(ctx);

      //smooth scroll
      if (this.targetScrollTop >= 0) {
        if (this.scrollStartTime === 0) {
          this.scrollStart = this.scrollContainer.scrollTop;
          this.scrollStartTime = currentTimestamp;
        }
        const elapsed = currentTimestamp - this.scrollStartTime;
        const t = Math.min(elapsed / this.scrollDuration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        this.scrollContainer.scrollTop = this.scrollStart + (this.targetScrollTop - this.scrollStart) * ease;
        if (t >= 1) {
          this.scrollContainer.scrollTop = this.targetScrollTop;
          this.targetScrollTop = -1;
          this.scrollStartTime = 0;
        }
      }

      if (skipped) {
        this.forceToActive();
      }

      this.lastTimestamp = currentTimestamp;
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /** Snap a line to its initial Idle state — safe because no animation has happened yet */
  private snapToIdle(line: LineInfo): void {
    if (line.isSyllableType && line.syllables.length > 0) {
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
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan) {
        lyricSpan.style.setProperty("--line-progress", "0%");
      }
    }
  }

  /** Set spring goals to final Sung position — springs will ease there naturally */
  private setSungGoals(line: LineInfo, ctx: FrameCtx): void {
    if (line.isSyllableType && line.syllables.length > 0) {
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
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
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
    if (line.isSyllableType && line.syllables.length > 0) {
      for (const syl of line.syllables) {
        if (syl.springs) {
          if (!syl.springs.Scale.CanSleep() || !syl.springs.YOffset.CanSleep() || !syl.springs.Glow.CanSleep()) {
            return false;
          }
        }
        for (const ltr of syl.letters) {
          if (ltr.springs) {
            if (!ltr.springs.Scale.CanSleep() || !ltr.springs.YOffset.CanSleep() || !ltr.springs.Glow.CanSleep()) {
              return false;
            }
          }
        }
      }
    } else if (line.dots) {
      for (const dot of line.dots) {
        if (!dot.springs.Scale.CanSleep() || !dot.springs.YOffset.CanSleep() ||
            !dot.springs.Glow.CanSleep() || !dot.springs.Opacity.CanSleep()) {
          return false;
        }
      }
    }
    if (line.glowSpring && !line.glowSpring.CanSleep()) return false;
    return true;
  }

  /** Step springs on a Sung line until they settle, then apply final DOM state */
  private stepSungLine(line: LineInfo, deltaTime: number, springConfig: SpicySpringConfig, ctx: FrameCtx): void {
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
            setCachedInline(ltr.span, "transform", `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset * 2}), 0)`);
            setCachedStyle(ltr.span, "--text-shadow-blur-radius", `${4 + 12 * values.glow * gi}px`);
            setCachedStyle(ltr.span, "--text-shadow-opacity", `${Math.min(values.glow * 185 * gi, 100)}%`);
          }
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      if (line.dots && line.dots.length > 0 && springConfig.enabled) {
        const dotScratch = { scale: 0, yOffset: 0, glow: 0, opacity: 0 };
        for (const dot of line.dots) {
          const v = stepDotSprings(dot.springs, deltaTime, dotScratch);
          setCachedInline(dot.span, "scale", `${v.scale}`);
          setCachedInline(dot.span, "transform", `translate3d(0, calc(var(--vl-default-font-size) * ${v.yOffset}), 0)`);
          setCachedInline(dot.span, "opacity", `${v.opacity}`);
          setCachedStyle(dot.span, "--text-shadow-blur-radius", `${4 + 6 * v.glow}px`);
          setCachedStyle(dot.span, "--text-shadow-opacity", `${v.glow * 90}%`);
        }
      }
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan && line.glowSpring && springConfig.enabled) {
        const gi = ctx.glowIntensity;
        const currentGlow = line.glowSpring.Step(deltaTime);
        setCachedStyle(lyricSpan, "--text-shadow-blur-radius", `${4 + 8 * currentGlow * gi}px`);
        setCachedStyle(lyricSpan, "--text-shadow-opacity", `${Math.min(currentGlow * 50 * gi, 100)}%`);
      }
    }
  }

  /** Promote line elements to GPU layer for animation */
  private promoteLine(line: LineInfo): void {
    if (line.isSyllableType) {
      for (const syl of line.syllables) {
        promoteToGPU(syl.span);
        for (const ltr of syl.letters) promoteToGPU(ltr.span);
      }
    } else if (line.dots) {
      for (const dot of line.dots) promoteToGPU(dot.span);
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan) promoteToGPU(lyricSpan);
    }
  }

  /** Demote line elements from GPU layer to free compositor memory */
  private demoteLine(line: LineInfo): void {
    if (line.isSyllableType) {
      for (const syl of line.syllables) {
        demoteFromGPU(syl.span);
        for (const ltr of syl.letters) demoteFromGPU(ltr.span);
      }
    } else if (line.dots) {
      for (const dot of line.dots) demoteFromGPU(dot.span);
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan) demoteFromGPU(lyricSpan);
    }
  }

  private animateLine(
    line: LineInfo,
    songTimestamp: number,
    deltaTime: number,
    springConfig: SpicySpringConfig,
    ctx?: FrameCtx,
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
        this.setSungGoals(line, ctx!);
      }

      if (stateNow === "Active") {
        this.promoteLine(line);
        this.scrollToActive();
      }
    }

    // Idle lines: no per-frame work
    if (stateNow === "Idle") return;

    // Sung lines: step springs until settled
    if (stateNow === "Sung") {
      if (line.settled) return;
      if (this.areSpringsSettled(line)) {
        line.settled = true;
        this.demoteLine(line);
        return;
      }
      this.stepSungLine(line, deltaTime, springConfig, ctx!);
      return;
    }

    // Active lines: full animation
    if (line.isSyllableType && line.syllables.length > 0 && line.duration > 0) {
      const timeScale = clamp(relativeTime / line.duration, 0, 1);
      const activeScratch = { scale: 0, yOffset: 0, glow: 0 };

      for (const syl of line.syllables) {
        const sylDuration = syl.endScale - syl.startScale || 0.01;
        const sylProgress = clamp(
          (timeScale - syl.startScale) / sylDuration,
          0,
          1
        );

        // Gradient progress
        const pct = -20 + sylProgress * 140;
        setCachedStyle(syl.span, "--char-progress", `${pct}%`);

        // Per-character gradient progress + spring animation
        for (const ltr of syl.letters) {
          const ltrDuration = ltr.endScale - ltr.startScale || 0.01;
          const ltrProgress = clamp(
            (timeScale - ltr.startScale) / ltrDuration,
            0, 1
          );

          const ltrPct = -20 + ltrProgress * 140;
          setCachedStyle(ltr.span, "--char-progress", `${ltrPct}%`);

          // Spring-driven animation for emphasized chars only (Spicy 1:1)
          if (springConfig.enabled && ltr.springs) {
            let activeLetterIndex = -1;
            let activeLetterPercentage = 0;
            for (let li = 0; li < syl.letters.length; li++) {
              const other = syl.letters[li];
              const otherDuration = other.endScale - other.startScale || 0.01;
              const otherProg = clamp(
                (timeScale - other.startScale) / otherDuration,
                0, 1
              );
              if (otherProg > 0 && otherProg < 1) {
                activeLetterIndex = li;
                activeLetterPercentage = otherProg;
                break;
              }
            }

            // Spicy-style emphasis stretch multiplier: longer words (>1500ms) get 1.103x, shorter get 1.09x
            const sylDurationMs = (syl.endScale - syl.startScale) * line.duration * 1000;
            const stretchMultiplier = sylDurationMs > EMPHASIS_LONGER_THAN_MS ? 1.103 : 1.09;

            let targetScale = ctx!.splines.Scale.at(0);
            let targetYOffset = ctx!.splines.YOffset.at(0);
            let targetGlow = ctx!.splines.Glow.at(0);

            if (activeLetterIndex >= 0) {
              const baseScale = ctx!.splines.Scale.at(activeLetterPercentage) * stretchMultiplier;
              const baseYOffset = ctx!.splines.YOffset.at(activeLetterPercentage);
              const baseGlow = ctx!.splines.Glow.at(activeLetterPercentage);

              const restingScale = ctx!.splines.Scale.at(0);
              const restingYOffset = ctx!.splines.YOffset.at(0);
              const restingGlow = ctx!.splines.Glow.at(0);

              const thisIdx = syl.letters.indexOf(ltr);
              const distance = Math.abs(thisIdx - activeLetterIndex);
              const isCurrent = get("springMode") === "current";
              const falloff = Math.max(0, 1 / (1 + (isCurrent ? Math.pow(distance, 2.8) : distance * 0.9)));
              const glowFalloff = Math.max(0, 1 / (1 + distance * 0.9));

              targetScale = restingScale + (baseScale - restingScale) * falloff;
              targetYOffset = restingYOffset + (baseYOffset - restingYOffset) * falloff;
              targetGlow = restingGlow + (baseGlow - restingGlow) * glowFalloff;
            } else {
              const ltrState = ltrProgress > 0 && ltrProgress < 1 ? "Active"
                : ltrProgress >= 1 ? "Sung" : "NotSung";

              if (ltrState === "NotSung") {
                targetScale = ctx!.splines.Scale.at(0);
                targetYOffset = ctx!.splines.YOffset.at(0);
                targetGlow = ctx!.splines.Glow.at(0);
              } else if (ltrState === "Sung") {
                targetScale = ctx!.splines.Scale.at(1);
                targetYOffset = ctx!.splines.YOffset.at(1);
                targetGlow = ctx!.splines.Glow.at(1);
              } else {
                targetScale = ctx!.splines.Scale.at(ltrProgress);
                targetYOffset = ctx!.splines.YOffset.at(ltrProgress);
                targetGlow = ctx!.splines.Glow.at(ltrProgress);
              }
            }

            ltr.springs.Scale.SetGoal(targetScale, replacePos);
            ltr.springs.YOffset.SetGoal(targetYOffset, replacePos);
            ltr.springs.Glow.SetGoal(targetGlow, replacePos);

            const values = stepSprings(ltr.springs, deltaTime, activeScratch);

            // Spicy 1:1 letter application: raw spring values, no intensity multiplier
            const gi = ctx!.glowIntensity;
            setCachedInline(ltr.span, "scale", `${values.scale}`);
            setCachedInline(ltr.span, "transform", `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset * 2}), 0)`);
            setCachedStyle(ltr.span, "--text-shadow-blur-radius", `${4 + 12 * values.glow * gi}px`);
            setCachedStyle(ltr.span, "--text-shadow-opacity", `${Math.min(values.glow * 185 * gi, 100)}%`);
          }
        }

        // Syllable-level spring (for non-emphasized syllables)
        if (springConfig.enabled && syl.springs) {
          const sylState = sylProgress > 0 && sylProgress < 1 ? "Active"
            : sylProgress >= 1 ? "Sung" : "NotSung";

          setSpringGoals(syl.springs, sylProgress, sylState, replacePos);
          const values = stepSprings(syl.springs, deltaTime, activeScratch);
          applySpringStyles(syl.span, values, ctx!.glowIntensity);
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      // Interlude dots animation (Spicy 1:1 with per-dot springs)
      if (line.dots && line.dots.length > 0 && springConfig.enabled) {
        const activeDotScratch = { scale: 0, yOffset: 0, glow: 0, opacity: 0 };
        for (const dot of line.dots) {
          const dotRelTime = songTimestamp - dot.startTime;
          const dotProgress = dot.duration > 0 ? clamp(dotRelTime / dot.duration, 0, 1) : 0;
          const dotPastStart = dotRelTime >= 0;
          const dotBeforeEnd = dotRelTime <= dot.duration;
          const dotState: "NotSung" | "Active" | "Sung" = dotPastStart && dotBeforeEnd
            ? "Active" : dotPastStart ? "Sung" : "NotSung";
          setDotSpringGoals(dot.springs, dotProgress, dotState, replacePos);
          const v = stepDotSprings(dot.springs, deltaTime, activeDotScratch);
          setCachedInline(dot.span, "scale", `${v.scale}`);
          setCachedInline(dot.span, "transform", `translate3d(0, calc(var(--vl-default-font-size) * ${v.yOffset}), 0)`);
          setCachedInline(dot.span, "opacity", `${v.opacity}`);
          setCachedStyle(dot.span, "--text-shadow-blur-radius", `${4 + 6 * v.glow}px`);
          setCachedStyle(dot.span, "--text-shadow-opacity", `${v.glow * 90}%`);
        }
      }
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan && line.duration > 0) {
        const lineProgress = clamp(relativeTime / line.duration, 0, 1);
        const gradientPos = lineProgress * 100;
        setCachedStyle(lyricSpan, "--line-progress", `${gradientPos}%`);

        // Glow spring: 0→1 at 50%→0 for text-shadow bloom (Spicy LineGlowSpline)
        if (springConfig.enabled && line.glowSpring) {
          const gi = ctx!.glowIntensity;
          const targetGlow = ctx!.splines.LineGlow.at(lineProgress);
          line.glowSpring.SetGoal(targetGlow, replacePos);
          const currentGlow = line.glowSpring.Step(deltaTime);
          setCachedStyle(lyricSpan, "--text-shadow-blur-radius", `${4 + 8 * currentGlow * gi}px`);
          setCachedStyle(lyricSpan, "--text-shadow-opacity", `${Math.min(currentGlow * 50 * gi, 100)}%`);
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

    if (!ctx?.blurEnabled) {
      for (let i = 0; i < this.lines.length; i++) {
        const line = this.lines[i];
        clearCachedStyle(line.container, "--vl-blur");
        line.container.style.removeProperty("--vl-blur");
        line.container.style.opacity = "";
      }
      return;
    }

    const strengthMul = ctx.blurStrengthMul;

    for (let i = 0; i < this.lines.length; i++) {
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

      setCachedStyle(line.container, "--vl-blur", blurPx > 0 ? `${blurPx}px` : "0");
      setCachedInline(line.container, "opacity", `${opacity}`);
    }
  }

  private scrollToActive(instant?: boolean): void {
    if (!get("autoScroll")) return;

    const activeIdx = this.lines.findIndex((l) => l.state === "Active");
    if (activeIdx === this.lastActiveIdx && !instant) return;
    this.lastActiveIdx = activeIdx;

    if (activeIdx < 0) {
      if (this.lyricsEnded) {
        this.targetScrollTop = this.scrollContainer.scrollHeight;
        this.scrollStartTime = 0;
      }
      return;
    }

    const activeLine = this.lines[activeIdx];
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const lineRect = activeLine.container.getBoundingClientRect();
    const lineRelativeTop = lineRect.top - containerRect.top;

    if (this.viewMode === "card") {
      const zones: Record<string, { min: number; max: number; target: number }> = {
        static:  { min: 0.15, max: 0.7, target: 0.15 },
        gentle:  { min: 0.25, max: 0.55, target: 0.25 },
        active:  { min: 0.3, max: 0.45, target: 0.25 },
      };
      const z = zones[this.cardScrollMode] ?? zones.static;
      if (lineRelativeTop < containerRect.height * z.min || lineRelativeTop > containerRect.height * z.max) {
        this.targetScrollTop = this.scrollContainer.scrollTop + lineRelativeTop - containerRect.height * z.target;
        this.scrollStartTime = 0;
      } else {
        return;
      }
    } else {
      // Main view: center in 20-60% region (~40%)
      const targetY = containerRect.height * 0.4;
      this.targetScrollTop = this.scrollContainer.scrollTop + lineRelativeTop - targetY + lineRect.height / 2;
      this.scrollStartTime = 0;
    }

    if (instant) {
      this.scrollContainer.scrollTop = this.targetScrollTop;
      this.targetScrollTop = -1;
    }
  }

  private forceToActive(): void {
    this.autoScrollBlocked = false;
    this.scrollContainer.classList.remove("UserScrolling");
    this.scrollToActive(true);
  }

  public destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    if (this.userScrollTimer) clearTimeout(this.userScrollTimer);

    // Clear internal references so GC can collect DOM elements + springs
    this.lines = [];
    this.scrollContainer.remove();
  }

  public appendCredits(creditsEl: HTMLElement): void {
    this.lyricsContainer.appendChild(creditsEl);
  }
}
