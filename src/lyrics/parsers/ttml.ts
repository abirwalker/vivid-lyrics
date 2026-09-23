import type {
  LineVocal,
  Syllable,
  SyllableVocal,
  SyllableVocalSet,
  TransformedLyrics,
} from "../types.ts";
import { addLineInterludes, addSyllableInterludes, isRtlLanguage } from "./common.ts";
import { detectRomanizedLanguage } from "../language.ts";

type ParserLike = {
  parseFromString(source: string, mimeType: string): Document;
};

type RawSegment = {
  text: string;
  startTime?: number;
  endTime?: number;
  role: string | null;
};

type RawLine = {
  text: string;
  startTime?: number;
  endTime?: number;
  agent: string | null;
  segments: RawSegment[];
};

const TTM_NS = "http://www.w3.org/ns/ttml#metadata";
const APPLE_NS = "http://music.apple.com/lyric-ttml-internal";
const LEGACY_APPLE_NS = "http://itunes.apple.com/lyric-ttml-extensions";
const BACKGROUND_ROLES = new Set(["x-bg", "background"]);
const SECONDARY_AGENTS = new Set(["v2", "duet", "vocal-2"]);

function parseTime(value: string | null): number | undefined {
  if (value === null) return undefined;
  const source = value.trim();
  const unit = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i.exec(source);
  if (unit) {
    const factors: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600 };
    const seconds = Number(unit[1]) * factors[unit[2].toLowerCase()];
    if (!Number.isFinite(seconds)) throw new Error("Invalid TTML time");
    return seconds;
  }
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(source)) {
    throw new Error("Unsupported TTML time");
  }
  const seconds = source.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  if (!Number.isFinite(seconds)) throw new Error("Invalid TTML time");
  return seconds;
}

function role(element: Element): string | null {
  return element.getAttributeNS(TTM_NS, "role")
    ?? element.getAttribute("ttm:role")
    ?? element.getAttribute("role");
}

function inheritedAgent(element: Element): string | null {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const agent = current.getAttributeNS(TTM_NS, "agent")
      ?? current.getAttribute("ttm:agent")
      ?? current.getAttribute("agent");
    if (agent) return agent;
  }
  return null;
}

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => (element.localName || element.tagName.split(":").at(-1)) === localName,
  );
}

function songwriters(document: Document): string[] | undefined {
  const names = elements(document, "songwriter")
    .map((element) => (element.textContent ?? "").trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)] : undefined;
}

function parseLines(document: Document): RawLine[] {
  const lines: RawLine[] = [];
  for (const paragraph of elements(document, "p")) {
    const startTime = parseTime(paragraph.getAttribute("begin"));
    const endTime = parseTime(paragraph.getAttribute("end"));
    if (startTime !== undefined && endTime !== undefined && endTime < startTime) {
      throw new Error("Reversed TTML line time");
    }

    const segments: RawSegment[] = [];
    const walk = (
      node: Node,
      inheritedStart: number | undefined,
      inheritedEnd: number | undefined,
      inheritedRole: string | null,
    ): void => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        const text = (node.textContent ?? "").replace(/[\t\r\n ]+/g, " ");
        if (text) {
          segments.push({ text, startTime: inheritedStart, endTime: inheritedEnd, role: inheritedRole });
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (element.localName === "br") {
        segments.push({ text: "\n", role: inheritedRole });
        return;
      }
      if (element.localName !== "span") return;
      const nextStart = element.hasAttribute("begin")
        ? parseTime(element.getAttribute("begin"))
        : inheritedStart;
      const nextEnd = element.hasAttribute("end")
        ? parseTime(element.getAttribute("end"))
        : inheritedEnd;
      if (nextStart !== undefined && nextEnd !== undefined && nextEnd < nextStart) {
        throw new Error("Reversed TTML segment time");
      }
      const nextRole = role(element) ?? inheritedRole;
      for (const child of Array.from(element.childNodes)) {
        walk(child, nextStart, nextEnd, nextRole);
      }
    };

    for (const child of Array.from(paragraph.childNodes)) {
      walk(child, undefined, undefined, role(paragraph));
    }
    if (!segments.length) continue;
    segments[0].text = segments[0].text.trimStart();
    segments[segments.length - 1].text = segments.at(-1)!.text.trimEnd();
    const nonempty = segments.filter((segment) => segment.text.length > 0);
    const text = nonempty.map((segment) => segment.text).join("");
    if (!text.trim()) continue;
    if (nonempty.some((segment) => segment.text.trim() && segment.startTime !== undefined)
      && startTime === undefined) {
      throw new Error("Word-timed TTML line has no start time");
    }
    lines.push({ text, startTime, endTime, agent: inheritedAgent(paragraph), segments: nonempty });
  }
  return lines.sort((a, b) => (a.startTime ?? Number.MAX_VALUE) - (b.startTime ?? Number.MAX_VALUE));
}

function isBackground(roleName: string | null): boolean {
  return roleName !== null && BACKGROUND_ROLES.has(roleName.toLowerCase());
}

function isAlternate(roleName: string | null): boolean {
  return roleName === "x-translation" || roleName === "x-roman";
}

function joinedText(segments: RawSegment[]): string {
  return segments.map((segment) => segment.text).join("").replace(/\s+/g, " ").trim();
}

function timedSyllables(
  segments: RawSegment[],
  lineStart: number,
  lineEnd: number,
): Syllable[] {
  const syllables: Syllable[] = [];
  const content = segments.filter((segment) => !isAlternate(segment.role));
  for (let index = 0; index < content.length; index++) {
    const segment = content[index];
    const text = segment.text.trim();
    if (!text) continue;
    const startTime = segment.startTime ?? lineStart;
    const endTime = Math.max(startTime + 0.01, segment.endTime ?? lineEnd);
    const between = content.slice(index + 1).find((next) => next.text.length > 0);
    const endsWord = /\s$/.test(segment.text)
      || (between ? /^\s/.test(between.text) : true)
      || /[,.!?;:\-–—、。！？]$/.test(text);
    syllables.push({ startTime, endTime, text, isPartOfWord: !endsWord });
  }
  return syllables;
}

function oppositeAligned(agent: string | null): boolean {
  return agent !== null && SECONDARY_AGENTS.has(agent.trim().toLowerCase());
}

function hasBackgroundAncestor(element: Element, paragraph: Element): boolean {
  for (let current: Element | null = element; current && current !== paragraph; current = current.parentElement) {
    if (isBackground(role(current))) return true;
  }
  return false;
}

function supportsAmllTiming(document: Document): boolean {
  const body = elements(document, "body")[0];
  if (!body || body.hasAttribute("begin") || body.hasAttribute("end")) return false;
  const bodyDuration = parseTime(body.getAttribute("dur"));
  if (bodyDuration !== undefined && bodyDuration <= 0) return false;

  for (const div of elements(body, "div")) {
    if (div.hasAttribute("dur")) return false;
    const divStart = parseTime(div.getAttribute("begin"));
    const divEnd = parseTime(div.getAttribute("end"));
    if ((divStart === undefined) !== (divEnd === undefined)) return false;
    if (divStart !== undefined && divEnd !== undefined && divEnd <= divStart) return false;
    if (bodyDuration !== undefined && divEnd !== undefined && divEnd > bodyDuration) return false;

    for (const paragraph of elements(div, "p")) {
      if (paragraph.hasAttribute("dur")) return false;
      const lineStart = parseTime(paragraph.getAttribute("begin"));
      const lineEnd = parseTime(paragraph.getAttribute("end"));
      if ((lineStart === undefined) !== (lineEnd === undefined)) return false;
      if (lineStart !== undefined && lineEnd !== undefined) {
        if (lineEnd <= lineStart) return false;
        if (divStart !== undefined && lineStart < divStart) return false;
        if (divEnd !== undefined && lineEnd > divEnd) return false;
        if (bodyDuration !== undefined && lineEnd > bodyDuration) return false;
      }

      for (const span of elements(paragraph, "span")) {
        if (span.hasAttribute("dur")) return false;
        const start = parseTime(span.getAttribute("begin"));
        const end = parseTime(span.getAttribute("end"));
        if ((start === undefined) !== (end === undefined)) return false;
        if (start !== undefined && end !== undefined) {
          if (lineStart === undefined || lineEnd === undefined || end <= start) return false;
          if (start < lineStart) return false;
          if (!hasBackgroundAncestor(span, paragraph) && end > lineEnd) return false;
          if (divEnd !== undefined && end > divEnd) return false;
          if (bodyDuration !== undefined && end > bodyDuration) return false;
        }
      }
    }
  }
  return true;
}

export function parseTtml(
  source: string,
  parser?: ParserLike,
  profile: "apple" | "amll" = "apple",
): TransformedLyrics | null {
  if (!source.trim() || /<!DOCTYPE/i.test(source)) return null;
  try {
    const activeParser = parser ?? new DOMParser();
    const document = activeParser.parseFromString(source, "application/xml");
    if (elements(document, "parsererror").length || document.documentElement?.localName !== "tt") {
      return null;
    }

    const root = document.documentElement;
    const timing = root.getAttributeNS(APPLE_NS, "timing")
      ?? root.getAttributeNS(LEGACY_APPLE_NS, "timing")
      ?? root.getAttribute("itunes:timing");
    const appleProfile = timing?.toLowerCase() === "word" || timing?.toLowerCase() === "line";
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      if (element.getAttribute("timeContainer") === "seq") return null;
      if (profile === "apple") {
        if (element.hasAttribute("dur") && !(appleProfile && element.localName === "body")) return null;
        if (["body", "div"].includes(element.localName)
          && (element.hasAttribute("begin") || element.hasAttribute("end"))
          && !appleProfile) return null;
      }
    }
    if (profile === "amll" && !supportsAmllTiming(document)) return null;

    const rawLines = parseLines(document);
    if (!rawLines.length) return null;
    const language = root.getAttribute("xml:lang")
      ?? root.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")
      ?? "und";
    const writers = songwriters(document);
    const romanizedLanguage = detectRomanizedLanguage(
      language,
      rawLines.flatMap((line) => line.segments)
        .filter((segment) => !isAlternate(segment.role))
        .map((segment) => segment.text),
    );
    const base = {
      naturalAlignment: isRtlLanguage(language) ? "Right" as const : "Left" as const,
      language,
      romanizedLanguage,
      ...(writers ? { songWriters: writers } : {}),
    };
    const anyTimed = rawLines.some((line) => line.startTime !== undefined);
    if (!anyTimed) {
      const lines = rawLines
        .map((line) => ({
          text: joinedText(line.segments.filter((segment) => !isBackground(segment.role) && !isAlternate(segment.role))),
          romanizedText: joinedText(line.segments.filter((segment) => segment.role === "x-roman")) || undefined,
        }))
        .filter((line) => line.text);
      return lines.length ? { ...base, type: "Static", lines } : null;
    }

    let previousEnd = 0;
    const normalized = rawLines.map((line) => {
      const startTime = line.startTime ?? previousEnd;
      const endTime = Math.max(startTime + 0.05, line.endTime ?? startTime + 3);
      previousEnd = endTime;
      const leadSegments = line.segments.filter((segment) => !isBackground(segment.role) && !isAlternate(segment.role));
      const backgroundSegments = line.segments.filter((segment) => isBackground(segment.role));
      const romanSegments = line.segments.filter((segment) => segment.role === "x-roman");
      return { line, startTime, endTime, leadSegments, backgroundSegments, romanSegments };
    });
    const hasWordTiming = normalized.some(({ leadSegments, backgroundSegments }) =>
      [...leadSegments, ...backgroundSegments].some((segment) => segment.startTime !== undefined),
    );

    if (!hasWordTiming) {
      const lines: LineVocal[] = normalized
        .map(({ line, startTime, endTime, leadSegments, romanSegments }) => ({
          type: "Vocal" as const,
          oppositeAligned: oppositeAligned(line.agent),
          startTime,
          endTime,
          text: joinedText(leadSegments),
          romanizedText: joinedText(romanSegments) || undefined,
        }))
        .filter((line) => line.text);
      if (!lines.length) return null;
      const content = addLineInterludes(lines);
      return {
        ...base,
        type: "Line",
        startTime: lines[0].startTime,
        endTime: content.at(-1)?.endTime ?? lines.at(-1)!.endTime,
        content,
      };
    }

    const lines: SyllableVocalSet[] = [];
    for (const { line, startTime, endTime, leadSegments, backgroundSegments, romanSegments } of normalized) {
      const syllables = timedSyllables(leadSegments, startTime, endTime);
      const roman = romanSegments.map((segment) => segment.text.trim()).filter(Boolean);
      if (roman.length === syllables.length) {
        for (let index = 0; index < syllables.length; index++) syllables[index].romanizedText = roman[index];
      }
      const backgroundSyllables = timedSyllables(backgroundSegments, startTime, endTime);
      const background: SyllableVocal[] = backgroundSyllables.length ? [{
        startTime: backgroundSyllables[0].startTime,
        endTime: backgroundSyllables.at(-1)!.endTime,
        syllables: backgroundSyllables,
      }] : [];
      if (!syllables.length && !background.length) continue;
      const lead = syllables.length ? syllables : [{
        startTime,
        endTime,
        text: joinedText(leadSegments),
        romanizedText: joinedText(romanSegments) || undefined,
        isPartOfWord: false,
      }];
      lines.push({
        type: "Vocal",
        oppositeAligned: oppositeAligned(line.agent),
        startTime,
        endTime,
        lead: { startTime, endTime, syllables: lead },
        ...(background.length ? { background } : {}),
      });
    }
    if (!lines.length) return null;
    const content = addSyllableInterludes(lines);
    return {
      ...base,
      type: "Syllable",
      startTime: lines[0].startTime,
      endTime: content.at(-1)?.endTime ?? lines.at(-1)!.endTime,
      content,
    };
  } catch {
    return null;
  }
}
