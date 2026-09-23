import type {
  Interlude,
  LineVocal,
  SyllableVocalSet,
} from "../types.ts";

export function isRtlLanguage(language: string): boolean {
  return ["ara", "ar", "heb", "he", "fas", "fa", "urd", "ur"]
    .includes(language.toLowerCase());
}

export function addLineInterludes(lines: LineVocal[]): (LineVocal | Interlude)[] {
  const content: (LineVocal | Interlude)[] = [];
  for (const line of lines) {
    const previous = content.at(-1);
    const previousEnd = previous?.endTime ?? 0;
    if (line.startTime - previousEnd >= 2.5) {
      content.push({ type: "Interlude", startTime: previousEnd, endTime: line.startTime });
    }
    content.push(line);
  }
  return content;
}

export function addSyllableInterludes(
  lines: SyllableVocalSet[],
): (SyllableVocalSet | Interlude)[] {
  const content: (SyllableVocalSet | Interlude)[] = [];
  for (const line of lines) {
    const previous = content.at(-1);
    const previousEnd = previous?.endTime ?? 0;
    if (line.startTime - previousEnd >= 2.5) {
      content.push({ type: "Interlude", startTime: previousEnd, endTime: line.startTime });
    }
    content.push(line);
  }
  return content;
}
