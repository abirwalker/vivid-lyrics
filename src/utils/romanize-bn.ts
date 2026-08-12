const BENGALI_RUN = /[\u0980-\u09FF]+/g;

function cleanBengaliText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u09AF\u09BC/g, "\u09DF") // য়
    .replace(/\u09A1\u09BC/g, "\u09DC") // ড়
    .replace(/\u09A2\u09BC/g, "\u09DD"); // ঢ়
}

const VOWELS: Record<string, string> = {
  "\u0985": "o", "\u0986": "a", "\u0987": "i", "\u0988": "i",
  "\u0989": "u", "\u098A": "u", "\u098B": "ri", "\u098F": "e",
  "\u0990": "oi", "\u0993": "o", "\u0994": "ou",
};

const MATRAS: Record<string, string> = {
  "\u09BE": "a", "\u09BF": "i", "\u09C0": "i", "\u09C1": "u",
  "\u09C2": "u", "\u09C3": "ri", "\u09C7": "e", "\u09C8": "oi",
  "\u09CB": "o", "\u09CC": "ou",
};

const CONSONANTS: Record<string, string> = {
  "\u0995": "k", "\u0996": "kh", "\u0997": "g", "\u0998": "gh", "\u0999": "ng",
  "\u099A": "ch", "\u099B": "chh", "\u099C": "j", "\u099D": "jh", "\u099E": "n",
  "\u099F": "t", "\u09A0": "th", "\u09A1": "d", "\u09A2": "dh", "\u09A3": "n",
  "\u09A4": "t", "\u09A5": "th", "\u09A6": "d", "\u09A7": "dh", "\u09A8": "n",
  "\u09AA": "p", "\u09AB": "f", "\u09AC": "b", "\u09AD": "bh", "\u09AE": "m",
  "\u09AF": "j", "\u09B0": "r", "\u09B2": "l", "\u09B6": "sh", "\u09B7": "sh",
  "\u09B8": "s", "\u09B9": "h", "\u09DC": "r", "\u09DD": "rh", "\u09DF": "y",
  "\u09CE": "t",
};

const VIRAMA = "\u09CD";
const CHANDRABINDU = "\u0981";
const ANUSVARA = "\u0982";
const VISARGA = "\u0983";

export function romanizeBengaliWord(rawWord: string): string {
  const word = cleanBengaliText(rawWord);
  let res = "";
  const chars = Array.from(word);
  const n = chars.length;

  for (let i = 0; i < n; i++) {
    const ch = chars[i];

    if (VOWELS[ch]) {
      const v = VOWELS[ch];
      if (!res.endsWith(v)) {
        res += v;
      }
    } else if (CONSONANTS[ch]) {
      const next1 = chars[i + 1];
      const next2 = chars[i + 2];

      // Jafala (consonant + VIRAMA + \u09AF / \u09DF)
      if (next1 === VIRAMA && (next2 === "\u09AF" || next2 === "\u09DF")) {
        const base = CONSONANTS[ch];
        res += base + "y";
        i += 2;
        const matra = chars[i + 1];
        if (MATRAS[matra]) {
          res += MATRAS[matra];
          i++;
        } else if (i < n - 1) {
          res += "a";
        }
        continue;
      }

      // Rafala (consonant + VIRAMA + \u09B0)
      if (next1 === VIRAMA && next2 === "\u09B0") {
        const base = CONSONANTS[ch];
        res += base + "r";
        i += 2;
        const matra = chars[i + 1];
        if (MATRAS[matra]) {
          res += MATRAS[matra];
          i++;
        } else if (i < n - 1) {
          res += "a";
        }
        continue;
      }

      // Standard VIRAMA: consonant + VIRAMA + consonant
      if (next1 === VIRAMA && CONSONANTS[next2]) {
        if (ch === "\u0995" && (next2 === "\u09B6" || next2 === "\u09B7")) {
          res += "kh";
          i += 2;
          continue;
        }
        if (ch === "\u099C" && next2 === "\u099E") {
          res += "gy";
          i += 2;
          continue;
        }

        res += CONSONANTS[ch];
        i++; // skip virama
        continue;
      }

      const base = CONSONANTS[ch];
      res += base;

      const hasVirama = next1 === VIRAMA;
      const hasMatra = !!(next1 && MATRAS[next1]);

      if (!hasVirama && !hasMatra) {
        const isLast =
          i === n - 1 ||
          (!VOWELS[next1] &&
            !CONSONANTS[next1] &&
            next1 !== CHANDRABINDU &&
            next1 !== ANUSVARA &&
            next1 !== VISARGA);
        if (!isLast || n === 1) {
          if (next1 !== "\u0993" && next1 !== "\u098F") {
            res += "o";
          }
        }
      }
    } else if (MATRAS[ch]) {
      res += MATRAS[ch];
    } else if (ch === ANUSVARA) {
      res += "ng";
    } else if (ch === VISARGA) {
      res += "h";
    } else if (ch === CHANDRABINDU) {
      res += "n";
    } else if (ch !== VIRAMA) {
      res += ch;
    }
  }

  return res;
}

export function romanizeBengaliLine(text: string): string {
  if (!text) return text;
  return text.replace(BENGALI_RUN, (match) => romanizeBengaliWord(match));
}

export { BENGALI_RUN };
