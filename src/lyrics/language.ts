const LANGUAGE_CODES: Record<string, string> = {
  jpn: "Japanese", ja: "Japanese",
  cmn: "Chinese", zh: "Chinese", zho: "Chinese", chi: "Chinese", cn: "Chinese",
  yue: "Cantonese",
  kor: "Korean", ko: "Korean",
  rus: "Russian", ru: "Russian",
  ukr: "Ukrainian", uk: "Ukrainian",
  bel: "Belarusian", be: "Belarusian",
  bul: "Bulgarian", bg: "Bulgarian",
  srp: "Serbian", sr: "Serbian",
  mkd: "Macedonian", mk: "Macedonian",
  ell: "Greek", el: "Greek",
  ara: "Arabic", ar: "Arabic",
  heb: "Hebrew", he: "Hebrew",
  hin: "Hindi", hi: "Hindi",
  ben: "Bengali", bn: "Bengali",
  tha: "Thai", th: "Thai",
};

const SCRIPT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[a-zA-Z]/g, "Latin"],
  [/[\u3040-\u309F\u30A0-\u30FF]/g, "Japanese"],
  [/[\uAC00-\uD7AF\u1100-\u11FF]/g, "Korean"],
  [/[\u0400-\u04FF]/g, "Cyrillic"],
  [/[\u0370-\u03FF]/g, "Greek"],
  [/[\u0600-\u06FF]/g, "Arabic"],
  [/[\u0590-\u05FF]/g, "Hebrew"],
  [/[\u0900-\u097F]/g, "Hindi"],
  [/[\u0980-\u09FF]/g, "Bengali"],
  [/[\u0E00-\u0E7F]/g, "Thai"],
  [/[\u4E00-\u9FFF]/g, "Chinese"],
];

function languageFromCode(language: string): string | undefined {
  if (!language || language.toLowerCase() === "und") return undefined;
  const normalized = language.toLowerCase().replace(/_/g, "-");
  return LANGUAGE_CODES[normalized] ?? LANGUAGE_CODES[normalized.split("-")[0]];
}

export function detectRomanizedLanguage(language: string, texts: Iterable<string>): string {
  const fromCode = languageFromCode(language);
  if (fromCode) return fromCode;

  const counts: Record<string, number> = {};
  for (const text of texts) {
    for (const [pattern, name] of SCRIPT_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) counts[name] = (counts[name] ?? 0) + matches.length;
    }
  }

  // Latin needs no romanization — mixed EN+ZH ad-libs must not win the count.
  let detected = "Latin";
  let largestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (name === "Latin") continue;
    if (count > largestCount) {
      detected = name;
      largestCount = count;
    }
  }
  if (largestCount === 0) return "Latin";
  if ((counts.Japanese ?? 0) > 0 && detected === "Chinese") return "Japanese";
  return detected;
}
