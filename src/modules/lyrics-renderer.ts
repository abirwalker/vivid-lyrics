import type { TransformedLyrics } from "../lyrics/types";
import { get } from "../stores/settings";

type LyricState = "Idle" | "Active" | "Sung";

type SyllableInfo = {
  span: HTMLSpanElement;
  startScale: number;
  endScale: number;
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
};

const BLURMAP = [0, 1, 2, 3, 4, 5];
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

  constructor(
    parentContainer: HTMLElement,
    private lyrics: TransformedLyrics
  ) {
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

            const span = document.createElement("span");
            span.className = "Syllable";
            span.textContent = s.Text;

            wordSpan.appendChild(span);

            syllableData.push({
              span,
              startScale: (sStartTime - startTime) / (duration || 1),
              endScale: (sEndTime - startTime) / (duration || 1),
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

  private startLoop(): void {
    const tick = () => {
      if (this.destroyed) return;

      const currentTimestamp = Spicetify.Player.getProgress() / 1000;
      const skipped =
        this.lastTimestamp >= 0 &&
        Math.abs(currentTimestamp - this.lastTimestamp) > 0.5;

      for (const line of this.lines) {
        this.animateLine(line, currentTimestamp);
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

  private animateLine(line: LineInfo, songTimestamp: number): void {
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
        const pct = sylProgress * 100;
        syl.span.style.setProperty("--char-progress", `${pct}%`);
        syl.span.style.setProperty("--char-progress-2", `${pct > 0 ? pct + 20 : 0}%`);
      }
    } else if (!line.isSyllableType && line.syllables.length === 0) {
      const lyricSpan = line.vocals.querySelector(".Lyric.Synced") as HTMLElement | null;
      if (lyricSpan && line.duration > 0) {
        const progress = clamp(relativeTime / line.duration, 0, 1) * 100;
        lyricSpan.style.setProperty("--line-progress", `${progress}%`);
        lyricSpan.style.setProperty("--line-progress-2", `${progress > 0 ? progress + 20 : 0}%`);
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

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      if (reset || activeStart === -1) {
        line.vocals.style.setProperty("--text-blur", "0px");
        continue;
      }

      let distance = BLURMAP.length - 1;
      if (i < activeStart) {
        distance = Math.min(activeStart - i, BLURMAP.length - 1);
      } else if (i > activeEnd) {
        distance = Math.min(i - activeEnd, BLURMAP.length - 1);
      } else {
        distance = 0;
      }

      line.vocals.style.setProperty("--text-blur", `${BLURMAP[distance]}px`);
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
