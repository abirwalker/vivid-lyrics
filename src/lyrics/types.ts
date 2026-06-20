type TimeRange = { startTime: number; endTime: number };
type TextContent = { text: string; romanizedText?: string };

export type Interlude = TimeRange & { type: "Interlude" };

export type StaticLyrics = {
  type: "Static";
  lines: TextContent[];
};

export type LineVocal = TimeRange & TextContent & {
  type: "Vocal";
  oppositeAligned: boolean;
};

export type LineLyrics = TimeRange & {
  type: "Line";
  content: (LineVocal | Interlude)[];
};

export type Syllable = TextContent & {
  isPartOfWord: boolean;
};

export type SyllableVocal = TimeRange & {
  syllables: Syllable[];
};

export type SyllableVocalSet = {
  type: "Vocal";
  oppositeAligned: boolean;
  lead: SyllableVocal;
  background?: SyllableVocal[];
};

export type SyllableLyrics = TimeRange & {
  type: "Syllable";
  content: (SyllableVocalSet | Interlude)[];
};

export type Lyrics = StaticLyrics | LineLyrics | SyllableLyrics;

export type TransformedLyrics = {
  naturalAlignment: "Left" | "Right";
  language: string;
  romanizedLanguage?: "Chinese" | "Japanese" | "Korean";
  songWriters?: string[];
} & Lyrics;
