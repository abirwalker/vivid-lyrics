import type { LineVocal, TransformedLyrics } from "../types.ts";
import { addLineInterludes } from "./common.ts";
import { detectRomanizedLanguage } from "../language.ts";

const TIMESTAMP = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
const METADATA = /^\[[a-z][a-z0-9_-]*:.*\]$/i;

export function parseLrc(
  source: string,
  options: { durationMs?: number; language?: string } = {},
): TransformedLyrics | null {
  if (!source.trim()) return null;
  const stamped: Array<{ startTime: number; text: string; order: number }> = [];
  let order = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || METADATA.test(line)) continue;
    const timestamps = [...line.matchAll(TIMESTAMP)];
    if (!timestamps.length) continue;
    const text = line.replace(TIMESTAMP, "").trim();
    if (!text) continue;

    for (const timestamp of timestamps) {
      const minutes = Number(timestamp[1]);
      const seconds = Number(timestamp[2].replace(":", "."));
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
      stamped.push({ startTime: minutes * 60 + seconds, text, order: order++ });
    }
  }

  if (!stamped.length) return null;
  stamped.sort((a, b) => a.startTime - b.startTime || a.order - b.order);
  const trackEnd = options.durationMs && options.durationMs > 0
    ? options.durationMs / 1000
    : undefined;
  const lines: LineVocal[] = stamped.map((line, index) => {
    let nextStart = trackEnd ?? line.startTime + 4;
    for (let nextIndex = index + 1; nextIndex < stamped.length; nextIndex++) {
      if (stamped[nextIndex].startTime > line.startTime) {
        nextStart = stamped[nextIndex].startTime;
        break;
      }
    }
    return {
      type: "Vocal",
      oppositeAligned: false,
      startTime: line.startTime,
      endTime: Math.max(line.startTime + 0.5, nextStart),
      text: line.text,
    };
  });
  const content = addLineInterludes(lines);
  return {
    type: "Line",
    naturalAlignment: "Left",
    language: options.language ?? "und",
    romanizedLanguage: detectRomanizedLanguage(
      options.language ?? "und",
      lines.map((line) => line.text),
    ),
    startTime: lines[0].startTime,
    endTime: content.at(-1)?.endTime ?? lines.at(-1)!.endTime,
    content,
  };
}

export function parsePlainLyrics(source: string, language = "und"): TransformedLyrics | null {
  const lines = source
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
  if (!lines.length) return null;
  return {
    type: "Static",
    naturalAlignment: "Left",
    language,
    romanizedLanguage: detectRomanizedLanguage(language, lines.map((line) => line.text)),
    lines,
  };
}
