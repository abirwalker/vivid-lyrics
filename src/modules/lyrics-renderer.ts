import type { TransformedLyrics } from "../lyrics/types";
import { get } from "../stores/settings";
import {
  createSpringSet,
  setSpringGoals,
  stepSprings,
  applySpringStyles,
  isEmphasized,
  ScaleSpline,
  YOffsetSpline,
  GlowSpline,
  LineGlowSpline,
  GLOW_FREQUENCY,
  GLOW_DAMPING,
  Spring,
  type SpringSet,
  type SpicySpringConfig,
} from "./spicy-spring";

const EMPHASIS_LONGER_THAN_MS = 1500;

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
};

const USER_SCROLL_RESUME_MS = 3000;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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

  private blurMap: number[];
  constructor(
    parentContainer: HTMLElement,
    private lyrics: TransformedLyrics,
    blurMap?: number[],
  ) {
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

    const content = (this.lyrics as any).content ?? [];
    for (const item of content) {
      const group = document.createElement("button");
      group.className = "VocalsGroup";

      if (item.Type === "Interlude") {
        const interlude = document.createElement("div");
        interlude.className = "Interlude";
        interlude.textContent = "...";
        group.appendChild(interlude);
        this.lyricsContainer.appendChild(group);
        this.lines.push({
          container: group,
          vocals: interlude as any,
          startTime: item.StartTime ?? 0,
          endTime: item.EndTime ?? 0,
          duration: (item.EndTime ?? 0) - (item.StartTime ?? 0),
          state: "Idle",
          syllables: [],
          isSyllableType: false,
          glowSpring: null,
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
                  springs: emphasized && textLen > 0 ? createSpringSet() : null,
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
          : new Spring(LineGlowSpline.at(0), GLOW_FREQUENCY, GLOW_DAMPING),
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

      for (const line of this.lines) {
        this.animateLine(line, currentTimestamp, deltaTime, springConfig);
      }

      this.lyricsEnded = currentTimestamp >= ((this.lyrics as any).endTime ?? Infinity);

      this.updateBlur();

      if (skipped) {
        this.forceToActive();
      }

      this.lastTimestamp = currentTimestamp;
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private animateLine(
    line: LineInfo,
    songTimestamp: number,
    deltaTime: number,
    springConfig: SpicySpringConfig
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
      this.evaluateClass(line);
    }

    if (line.isSyllableType && line.syllables.length > 0 && line.duration > 0) {
      const timeScale = clamp(relativeTime / line.duration, 0, 1);

      for (const syl of line.syllables) {
        const sylDuration = syl.endScale - syl.startScale || 0.01;
        const sylProgress = clamp(
          (timeScale - syl.startScale) / sylDuration,
          0,
          1
        );

        // Gradient progress (always applied)
        const pct = -20 + sylProgress * 140;
        syl.span.style.setProperty("--char-progress", `${pct}%`);

        // Per-character gradient progress (always applied)
        for (const ltr of syl.letters) {
          const ltrDuration = ltr.endScale - ltr.startScale || 0.01;
          const ltrProgress = clamp(
            (timeScale - ltr.startScale) / ltrDuration,
            0, 1
          );

          const ltrPct = -20 + ltrProgress * 140;
          ltr.span.style.setProperty("--char-progress", `${ltrPct}%`);

          // Spring-driven animation for emphasized chars only (Spicy 1:1)
          if (springConfig.enabled && ltr.springs) {
            let activeLetterIndex = -1;
            let activeLetterPercentage = 0;
            if (stateNow === "Active") {
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
            }

            // Spicy-style emphasis stretch multiplier: longer words (>1500ms) get 1.103x, shorter get 1.09x
            const sylDurationMs = (syl.endScale - syl.startScale) * line.duration * 1000;
            const stretchMultiplier = sylDurationMs > EMPHASIS_LONGER_THAN_MS ? 1.103 : 1.09;

            let targetScale = ScaleSpline.at(0);
            let targetYOffset = YOffsetSpline.at(0);
            let targetGlow = GlowSpline.at(0);

            if (activeLetterIndex >= 0) {
              const baseScale = ScaleSpline.at(activeLetterPercentage) * stretchMultiplier;
              const baseYOffset = YOffsetSpline.at(activeLetterPercentage);
              const baseGlow = GlowSpline.at(activeLetterPercentage);

              const restingScale = ScaleSpline.at(0);
              const restingYOffset = YOffsetSpline.at(0);
              const restingGlow = GlowSpline.at(0);

              const thisIdx = syl.letters.indexOf(ltr);
              const distance = Math.abs(thisIdx - activeLetterIndex);
              const falloff = Math.max(0, 1 / (1 + distance * 0.9));

              targetScale = restingScale + (baseScale - restingScale) * falloff;
              targetYOffset = restingYOffset + (baseYOffset - restingYOffset) * falloff;
              targetGlow = restingGlow + (baseGlow - restingGlow) * falloff;
            } else {
              const ltrState = stateNow === "Sung" ? "Sung"
                : ltrProgress > 0 && ltrProgress < 1 ? "Active"
                : ltrProgress >= 1 ? "Sung" : "NotSung";

              if (ltrState === "NotSung") {
                targetScale = ScaleSpline.at(0);
                targetYOffset = YOffsetSpline.at(0);
                targetGlow = GlowSpline.at(0);
              } else if (ltrState === "Sung") {
                targetScale = ScaleSpline.at(1);
                targetYOffset = YOffsetSpline.at(1);
                targetGlow = GlowSpline.at(1); // = 0 — no glow after word is sung
              } else {
                targetScale = ScaleSpline.at(ltrProgress);
                targetYOffset = YOffsetSpline.at(ltrProgress);
                targetGlow = GlowSpline.at(ltrProgress);
              }
            }

            ltr.springs.Scale.SetGoal(targetScale, replacePos);
            ltr.springs.YOffset.SetGoal(targetYOffset, replacePos);
            ltr.springs.Glow.SetGoal(targetGlow, replacePos);

            const values = stepSprings(ltr.springs, deltaTime);

            // Spicy 1:1 letter application: raw spring values, no intensity multiplier
            const gi = get("glowIntensity");
            ltr.span.style.scale = `${values.scale}`;
            ltr.span.style.transform = `translate3d(0, calc(var(--vl-default-font-size) * ${values.yOffset * 2}), 0)`;
            ltr.span.style.setProperty("--text-shadow-blur-radius", `${4 + 12 * values.glow * gi}px`);
            ltr.span.style.setProperty("--text-shadow-opacity", `${Math.min(values.glow * 185 * gi, 100)}%`);
          }
        }

        // Syllable-level spring (for non-emphasized syllables)
        if (springConfig.enabled && syl.springs) {
          const sylState = stateNow === "Active"
            ? (sylProgress > 0 && sylProgress < 1 ? "Active" : sylProgress >= 1 ? "Sung" : "NotSung")
            : stateNow === "Sung" ? "Sung" : "NotSung";

          setSpringGoals(syl.springs, sylProgress, sylState, replacePos);
          const values = stepSprings(syl.springs, deltaTime);
          applySpringStyles(syl.span, values, get("glowIntensity"));
        }
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan && line.duration > 0) {
        const lineProgress = clamp(relativeTime / line.duration, 0, 1);
        // Line-wide gradient progress (0% → 100% across line duration)
        const gradientPos = lineProgress * 100;
        lyricSpan.style.setProperty("--line-progress", `${gradientPos}%`);

        // Glow spring: 0→1 at 50%→0 for text-shadow bloom (Spicy LineGlowSpline)
        if (springConfig.enabled && line.glowSpring) {
          const gi = get("glowIntensity");
          const targetGlow = stateNow === "Active"
            ? LineGlowSpline.at(lineProgress)
            : 0;
          line.glowSpring.SetGoal(targetGlow, replacePos);
          const currentGlow = line.glowSpring.Step(deltaTime);
          lyricSpan.style.setProperty("--text-shadow-blur-radius", `${4 + 8 * currentGlow * gi}px`);
          lyricSpan.style.setProperty("--text-shadow-opacity", `${Math.min(currentGlow * 50 * gi, 100)}%`);
        }
      }
    }

    if (stateChanged && stateNow === "Active") {
      this.scrollToActive();
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

  private updateBlur(): void {
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

    if (!get("blurEnabled")) {
      for (let i = 0; i < this.lines.length; i++) {
        const line = this.lines[i];
        line.container.style.removeProperty("--vl-blur");
        line.container.style.opacity = "";
      }
      return;
    }

    const strengthMul = get("blurStrength") === "light" ? 0.5
      : get("blurStrength") === "heavy" ? 1.5
      : 1;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      if (reset || activeStart === -1) {
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

      line.container.style.setProperty("--vl-blur", blurPx > 0 ? `${blurPx}px` : "0");
      line.container.style.opacity = `${opacity}`;
    }
  }

  private scrollToActive(instant?: boolean): void {
    if (!get("autoScroll")) return;

    const activeIdx = this.lines.findIndex((l) => l.state === "Active");
    if (activeIdx === this.lastActiveIdx && !instant) return;
    this.lastActiveIdx = activeIdx;

    if (activeIdx < 0) {
      if (this.lyricsEnded) {
        this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
      }
      return;
    }

    const activeLine = this.lines[activeIdx];
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const lineRect = activeLine.container.getBoundingClientRect();
    const offset =
      lineRect.top - containerRect.top - containerRect.height / 2 + lineRect.height / 2;

    if (instant) {
      this.scrollContainer.scrollTop += offset;
    } else {
      this.scrollContainer.scrollTo({
        top: this.scrollContainer.scrollTop + offset,
        behavior: "smooth",
      });
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
    this.scrollContainer.remove();
  }

  public appendCredits(creditsEl: HTMLElement): void {
    this.lyricsContainer.appendChild(creditsEl);
  }
}
