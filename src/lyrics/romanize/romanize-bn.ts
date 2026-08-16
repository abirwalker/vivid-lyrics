const BENGALI_RUN = /[\u0980-\u09FF]+/g;

function cleanBengaliText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u09AF\u09BC/g, "\u09DF") // য়
    .replace(/\u09A1\u09BC/g, "\u09DC") // ড়
    .replace(/\u09A2\u09BC/g, "\u09DD"); // ঢ়
}

// ---------------------------------------------------------------------------
// Character mappings
// ---------------------------------------------------------------------------

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
  "\u099A": "ch", "\u099B": "ch", "\u099C": "j", "\u099D": "jh", "\u099E": "n",
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

// ---------------------------------------------------------------------------
// Word Romanizer
// ---------------------------------------------------------------------------

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
      const wasPreviousVirama =
        (i > 0 && chars[i - 1] === VIRAMA) || (i > 0 && chars[i - 1] === VISARGA);

      // Ref + Jafala: \u09B0 + VIRAMA + \u09AF (e.g. surjo, karjo)
      if (ch === "\u09B0" && next1 === VIRAMA && (next2 === "\u09AF" || next2 === "\u09DF")) {
        res += "rj";
        i += 2;
        const matra = chars[i + 1];
        if (MATRAS[matra]) {
          res += MATRAS[matra];
          i++;
        } else {
          res += "o";
        }
        continue;
      }

      // Bafala: consonant + VIRAMA + \u09AC
      if (next1 === VIRAMA && next2 === "\u09AC") {
        const base = CONSONANTS[ch];
        if (ch === "\u09AE") {
          res += "mb";
        } else if (ch === "\u09A4") {
          res += "tt";
        } else if (i === 0 || ch === "\u09B8" || ch === "\u09B6") {
          res += base + "w";
        } else {
          res += base + "b";
        }

        i += 2;
        const matra = chars[i + 1];
        if (MATRAS[matra]) {
          res += MATRAS[matra];
          i++;
        } else {
          res += "o";
        }
        continue;
      }

      // Jafala: consonant + VIRAMA + \u09AF / \u09DF
      if (next1 === VIRAMA && (next2 === "\u09AF" || next2 === "\u09DF")) {
        const base = CONSONANTS[ch];
        const matra = chars[i + 3];
        if (i === 0) {
          res += base + "y";
          i += 2;
          if (MATRAS[matra]) {
            res += MATRAS[matra];
            i++;
          } else if (i < n - 1) {
            res += "a";
          }
        } else {
          const doubled = base.length > 1 ? base : base + base;
          res += doubled;
          i += 2;
          if (MATRAS[matra]) {
            res += MATRAS[matra];
            i++;
          } else {
            res += "o";
          }
        }
        continue;
      }

      // Rafala: consonant + VIRAMA + \u09B0
      if (next1 === VIRAMA && next2 === "\u09B0") {
        const base = CONSONANTS[ch];
        res += base + "r";
        i += 2;
        const matra = chars[i + 1];
        if (MATRAS[matra]) {
          res += MATRAS[matra];
          i++;
        } else {
          res += "o";
        }
        continue;
      }

      // Standard VIRAMA: consonant + VIRAMA + consonant
      if (next1 === VIRAMA && CONSONANTS[next2]) {
        if (ch === "\u0995" && (next2 === "\u09B6" || next2 === "\u09B7")) {
          const next3 = chars[i + 3];
          const next4 = chars[i + 4];
          // Handle compound clusters: ক্ষ্য (lokkho, olokkhe) and ক্ষ্ম (lokkhi, sukkho)
          if (next3 === VIRAMA && (next4 === "\u09AF" || next4 === "\u09DF" || next4 === "\u09AE")) {
            res += i === 0 ? "kh" : "kkh";
            i += 4;
            const matra = chars[i + 1];
            if (MATRAS[matra]) {
              res += MATRAS[matra];
              i++;
            } else {
              res += "o";
            }
            continue;
          }

          res += i === 0 ? "kh" : "kkh";
          i += 2;
          const nextAfterKsh = chars[i + 1];
          if (MATRAS[nextAfterKsh]) {
            res += MATRAS[nextAfterKsh];
            i++;
          } else {
            res += "o";
          }
          continue;
        }
        if (ch === "\u099C" && next2 === "\u099E") {
          const matra = chars[i + 3];
          if (i === 0) {
            res += "gy";
            i += 2;
            if (MATRAS[matra]) {
              res += MATRAS[matra];
              i++;
            }
          } else {
            if (MATRAS[matra]) {
              res += "ggy" + MATRAS[matra];
              i += 3;
            } else {
              res += "ggo";
              i += 2;
            }
          }
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

      if (!hasVirama && !hasMatra && ch !== "\u09CE") {
        const isLast =
          i === n - 1 ||
          (!VOWELS[next1] &&
            !CONSONANTS[next1] &&
            next1 !== CHANDRABINDU &&
            next1 !== ANUSVARA &&
            next1 !== VISARGA);

        const prevChar = chars[i - 1];

        // Closed o-matra words stay closed (rod, lok, rog, chokh) while kono, choto retain 'o'
        const isEMatraFinal =
          isLast &&
          ((prevChar === "\u09CB" && (ch === "\u09A8" || ch === "\u099F")) ||
            (prevChar === "\u09C7" && ch === "\u09A8"));

        const isRetainedFinalConsonant =
          isLast &&
          (ch === "\u09AD" ||
            ch === "\u09B9" ||
            ch === "\u09AF" ||
            ch === "\u099B" ||
            (ch === "\u09DF" && (prevChar === "\u09BF" || prevChar === "\u09C1" || prevChar === "\u09C7")));
        const isConjunctFinal = isLast && wasPreviousVirama;

        // 2-consonant bare words (koto, joto, boro) or ri-matra words (drirho, mrito, krito, dhrito)
        const is2ConsonantTOrR =
          isLast &&
          (n === 2 || prevChar === "\u09C3") &&
          (ch === "\u09A4" || ch === "\u09DC" || ch === "\u09DD");

        // Verbal -te suffix drops inherent 'o' (bolte, cholte, korte, porte, haste, kadte)
        const isVerbalStemBeforeTe =
          next1 === "\u09A4" &&
          chars[i + 2] === "\u09C7" &&
          (ch === "\u09B2" || ch === "\u09DC" || ch === "\u09B8" || ch === "\u09A6" || (i === 1 && ch === "\u09B0" && !MATRAS[chars[0]]));

        const isBeforeVerbalSuffix =
          next1 === "\u099B" ||
          next1 === "\u099A" ||
          isVerbalStemBeforeTe;

        // Consonant before -ra or -la drops inherent 'o' (amra, tomra, kamra, pagla, ekla)
        const isBeforeRaOrLaSuffix =
          !isLast &&
          (next1 === "\u09B0" || next1 === "\u09B2") &&
          chars[i + 2] === "\u09BE";

        if (
          (!isLast && !isBeforeVerbalSuffix && !isBeforeRaOrLaSuffix) ||
          n === 1 ||
          isEMatraFinal ||
          isRetainedFinalConsonant ||
          isConjunctFinal ||
          is2ConsonantTOrR
        ) {
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
      const nextChar = chars[i + 1];
      if (nextChar === "\u0996" || nextChar === "\u0995") {
        res += "k";
      } else {
        res += "h";
      }
    } else if (ch === CHANDRABINDU) {
      // Chandrabindu dropped for natural Banglish lyrics
    } else if (ch !== VIRAMA) {
      res += ch;
    }
  }

  return res.replace(/hh+/g, "h").replace(/t{3,}/g, "tt");
}

// ---------------------------------------------------------------------------
// Line Romanizer
// ---------------------------------------------------------------------------

export function romanizeBengaliLine(text: string): string {
  if (!text) return text;
  return text.replace(BENGALI_RUN, (match) => romanizeBengaliWord(match));
}

export { BENGALI_RUN };
