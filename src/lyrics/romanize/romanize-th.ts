import { NewmmTokenizer, tccPos } from "nlpo3-newmm-typescript";

const THAI_RUN = /[\u0E00-\u0E7F]+/g;
type ThaiSegments = string[];

const TONE_MARKS = new Set(["\u0E48", "\u0E49", "\u0E4A", "\u0E4B"]); // ่ ้ ๊ ๋
const SILENT_MARK = "\u0E4C"; // ์
const REPEAT_MARK = "\u0E46"; // ๆ
const ABBREV_MARK = "\u0E2F"; // ฯ

const THAI_DIGITS: Record<string, string> = {
  "\u0E50": "0", "\u0E51": "1", "\u0E52": "2", "\u0E53": "3", "\u0E54": "4",
  "\u0E55": "5", "\u0E56": "6", "\u0E57": "7", "\u0E58": "8", "\u0E59": "9",
};

const VOWEL_LEAD: Record<string, string> = {
  "\u0E40": "e", // เ
  "\u0E41": "ae", // แ
  "\u0E42": "o", // โ
  "\u0E43": "ai", // ใ
  "\u0E44": "ai", // ไ
};

const VOWEL_ATTACH: Record<string, string> = {
  "\u0E31": "a", // ั
  "\u0E34": "i", // ิ
  "\u0E35": "i", // ี
  "\u0E36": "ue", // ึ
  "\u0E37": "ue", // ื
  "\u0E38": "u", // ุ
  "\u0E39": "u", // ู
};

const CLUSTER_PAIRS = new Set([
  "กร", "กล", "กว",
  "ขร", "ขล", "ขว",
  "คร", "คล", "คว",
  "ปร", "ปล",
  "พร", "พล",
  "ผร", "ผล",
  "ตร",
]);

const FINAL_MAP: Record<string, string> = {
  "\u0E01": "k", "\u0E02": "k", "\u0E04": "k", "\u0E06": "k", // ก ข ค ฆ
  "\u0E07": "ng", // ง
  "\u0E08": "t", "\u0E09": "t", "\u0E0A": "t", "\u0E0B": "t", "\u0E0C": "t", // จ ฉ ช ซ ฌ
  "\u0E0E": "t", "\u0E0F": "t", "\u0E10": "t", "\u0E11": "t", "\u0E12": "t", // ฎ ฏ ฐ ฑ ฒ
  "\u0E14": "t", "\u0E15": "t", "\u0E16": "t", "\u0E17": "t", "\u0E18": "t", // ด ต ถ ท ธ
  "\u0E28": "t", "\u0E29": "t", "\u0E2A": "t", // ศ ษ ส
  "\u0E0D": "n", "\u0E13": "n", "\u0E19": "n", "\u0E23": "n", "\u0E25": "n", "\u0E2C": "n", // ญ ณ น ร ล ฬ
  "\u0E1A": "p", "\u0E1B": "p", "\u0E1E": "p", "\u0E20": "p", // บ ป พ ภ
  "\u0E21": "m", // ม
  "\u0E22": "y", // ย
  "\u0E27": "w", // ว
};

const INITIAL_MAP: Record<string, string> = {
  "\u0E01": "k", // ก
  "\u0E02": "kh", // ข
  "\u0E03": "kh", // ฃ
  "\u0E04": "kh", // ค
  "\u0E05": "kh", // ฅ
  "\u0E06": "kh", // ฆ
  "\u0E07": "ng", // ง
  "\u0E08": "ch", // จ
  "\u0E09": "ch", // ฉ
  "\u0E0A": "ch", // ช
  "\u0E0B": "s", // ซ
  "\u0E0C": "ch", // ฌ
  "\u0E0D": "y", // ญ
  "\u0E0E": "d", // ฎ
  "\u0E0F": "t", // ฏ
  "\u0E10": "th", // ฐ
  "\u0E11": "th", // ฑ
  "\u0E12": "th", // ฒ
  "\u0E13": "n", // ณ
  "\u0E14": "d", // ด
  "\u0E15": "t", // ต
  "\u0E16": "th", // ถ
  "\u0E17": "th", // ท
  "\u0E18": "th", // ธ
  "\u0E19": "n", // น
  "\u0E1A": "b", // บ
  "\u0E1B": "p", // ป
  "\u0E1C": "ph", // ผ
  "\u0E1D": "f", // ฝ
  "\u0E1E": "ph", // พ
  "\u0E1F": "f", // ฟ
  "\u0E20": "ph", // ภ
  "\u0E21": "m", // ม
  "\u0E22": "y", // ย
  "\u0E23": "r", // ร
  "\u0E24": "rue", // ฤ
  "\u0E25": "l", // ล
  "\u0E27": "w", // ว
  "\u0E28": "s", // ศ
  "\u0E29": "s", // ษ
  "\u0E2A": "s", // ส
  "\u0E2B": "h", // ห
  "\u0E2C": "l", // ฬ
  "\u0E2D": "o", // อ
  "\u0E2E": "h", // ฮ
};

const SONORANTS = new Set([
  "\u0E07", "\u0E0D", "\u0E13", "\u0E19", "\u0E21", "\u0E22", "\u0E23", "\u0E25", "\u0E27", "\u0E2C",
]);

function isConsonant(c: string | undefined): boolean {
  if (!c) return false;
  const code = c.charCodeAt(0);
  return code >= 0x0e01 && code <= 0x0e2e;
}

function isVowelStart(c: string | undefined): boolean {
  if (!c) return false;
  return (
    !!VOWEL_LEAD[c] || !!VOWEL_ATTACH[c] ||
    c === "\u0E30" || c === "\u0E32" || c === "\u0E33" || c === "\u0E2D" || c === "\u0E47"
  );
}

function initialOf(c: string): string {
  return INITIAL_MAP[c] ?? "";
}

function finalOf(c: string): string {
  return FINAL_MAP[c] ?? initialOf(c);
}

const O_O = "\u0E2D"; // อ
const Y_Y = "\u0E22"; // ย
const W_W = "\u0E27"; // ว

/** Resolve a leading vowel (เ แ โ ใ ไ) given the upcoming glyphs. */
function resolveLead(lead: string | undefined, next: string | undefined, next2: string | undefined): { value: string; consume: number } {
  if (!lead) return { value: "", consume: 0 };
  switch (lead) {
    case "\u0E40": // เ
      if (next === "\u0E35" && next2 === Y_Y) return { value: "ia", consume: 2 }; // เ-ี-ย
      if (next === "\u0E37" && next2 === O_O) return { value: "uea", consume: 2 }; // เ-ื-อ
      if (next === O_O) return { value: "oe", consume: 1 }; // เ-อ
      if (next === "\u0E32") return { value: "ao", consume: 1 }; // เ-า
      if (next === "\u0E30") return { value: "e", consume: 1 }; // เ-ะ
      if (next === "\u0E47") return { value: "e", consume: 1 }; // เ-็
      if (next === Y_Y) return { value: "oe", consume: 1 }; // เ-ย word-final (เลย → loei)
      return { value: "e", consume: 0 };
    case "\u0E41": // แ
      if (next === "\u0E30") return { value: "ae", consume: 1 };
      if (next === "\u0E47") return { value: "ae", consume: 1 };
      if (next === O_O) return { value: "ae", consume: 1 };
      return { value: "ae", consume: 0 };
    case "\u0E42": // โ
      if (next === "\u0E30") return { value: "o", consume: 1 };
      if (next === O_O) return { value: "o", consume: 1 };
      return { value: "o", consume: 0 };
    default: // ใ ไ
      return { value: "ai", consume: 0 };
  }
}

/**
 * Romanize one pure-Thai word (no spaces, no Latin) using the
 * Royal Thai General System conventions.
 */
export function romanizeThaiWord(word: string): string {
  const raw = [...word];

  // Normalize digits, strip tone marks, drop ๆ / ฯ.
  const clean: string[] = [];
  for (const c of raw) {
    const digit = THAI_DIGITS[c];
    if (digit) { clean.push(digit); continue; }
    if (TONE_MARKS.has(c)) continue;
    if (c === REPEAT_MARK || c === ABBREV_MARK) continue;
    clean.push(c);
  }

  // ์ (thanthakhat): the consonant it marks is silent (พุทธ → phut).
  const chars: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === SILENT_MARK) {
      chars.pop();
    } else {
      chars.push(clean[i]);
    }
  }

  // Established-usage readings that override the plain rules
  // (ขอบคุณ → khobkhun, keeping the b of conventional romanization).
  const overrides: Record<string, string> = {
    "\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13": "khobkhun",
    "\u0E2A\u0E07\u0E2A\u0E31\u0E22": "songsai", // สงสัย
    "\u0E15\u0E01\u0E43\u0E08": "tokchai", // ตกใจ
    "\u0E44\u0E14\u0E49\u0E22\u0E34\u0E19": "daiyin", // ได้ยิน
    "\u0E04\u0E19\u0E2D\u0E37\u0E48\u0E19": "khonuen", // คนอื่น
  };
  const key = chars.join("");
  if (overrides[key]) return overrides[key];

  let result = "";
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const iterStart = i;
    const c = chars[i];

    // Non-Thai junk inside a token (dictionary phrases contain spaces and
    // dots): pass it through verbatim instead of stalling the scanner.
    if (!isConsonant(c) && !isVowelStart(c)) {
      result += c;
      i++;
      continue;
    }

    if (c === "\u0E24") { result += "rue"; i++; continue; } // ฤ
    if (c === "\u0E26") { result += "lue"; i++; continue; } // ฦ

    let pendingLead: string | null = null;
    if (VOWEL_LEAD[c]) {
      pendingLead = c;
      i++;
    }

    // Onset consonant stack. อ after an onset consonant is the vowel /o/
    // (สอน → son), so the stack stops there.
    const stackStart = i;
    let stack = "";
    while (i < n && isConsonant(chars[i]) && !(chars[i] === O_O && stack.length > 0)) {
      stack += chars[i];
      i++;
    }

    // --- Vowel resolution at the current position ---
    const v = chars[i];
    let vowel: string | null = null;
    let consumed = 0;

    if (VOWEL_LEAD[v] && pendingLead) {
      // A second leading vowel after a pending one starts a new syllable
      // (ประเทศ → prathet + thai): close the current syllable at the first
      // consonant, keep the new vowel for the next pass.
      const leadValue = resolveLead(pendingLead, undefined, undefined).value;
      if (stack.length === 1) {
        result += initialOf(stack[0]) + leadValue;
      } else if (stack.length >= 2) {
        result += initialOf(stack[0]) + leadValue + (stack[1] === W_W && leadValue === "ae" ? "o" : finalOf(stack[1]));
      }
      continue;
    }

    if (VOWEL_LEAD[v]) {
      const r = resolveLead(v, chars[i + 1], chars[i + 2]);
      vowel = r.value;
      consumed = r.consume;
    } else if (v === "\u0E33") { // ำ
      vowel = "am";
      consumed = 1;
    } else if (v === O_O) { // อ as vowel
      if (pendingLead === "\u0E40") { vowel = "oe"; consumed = chars[i + 1] === "\u0E30" ? 2 : 1; }
      else if (pendingLead === "\u0E41") { vowel = "ae"; consumed = 1; }
      else { vowel = "o"; consumed = 1; }
    } else if (VOWEL_ATTACH[v]) {
      if (v === "\u0E31" && chars[i + 1] === W_W) { vowel = "ua"; consumed = 2; } // ั-ว
      else if (v === "\u0E37" && chars[i + 1] === O_O) { vowel = "uea"; consumed = 2; } // ื-อ
      else if (v === "\u0E35" && pendingLead === "\u0E40" && chars[i + 1] === Y_Y) { vowel = "ia"; consumed = 2; } // เ-ี-ย
      else if (pendingLead === "\u0E40" && (v === "\u0E34" || v === "\u0E35")) { vowel = "oe"; consumed = 1; } // เ-ิ/ี (เดิน → doen)
      else { vowel = VOWEL_ATTACH[v]; consumed = 1; }
    } else if (v === "\u0E30") { // ะ
      vowel = "a";
      consumed = 1;
    } else if (v === "\u0E32") { // า
      vowel = pendingLead === "\u0E40" ? "ao" : "a";
      consumed = 1;
    } else if (v === "\u0E47") { // ็
      vowel = pendingLead === "\u0E40" ? "e" : pendingLead === "\u0E41" ? "ae" : null;
      consumed = 1;
    }

    const hasVowel = vowel !== null;

    // --- Onset stack resolution ---
    let o = stack;
    let specialInitial: string | null = null;
    let stackCut = 0; // consonants consumed before o[0] by the special rules

    // Special reduced clusters: ทร สร ศร → s, อย → y, จร → ch, ห + sonorant → sonorant.
    if (o === "\u0E17\u0E23" || o === "\u0E2A\u0E23" || o === "\u0E28\u0E23") {
      specialInitial = "s";
      stackCut = 2;
      o = "";
    } else if (o === O_O + Y_Y) {
      specialInitial = "y";
      stackCut = 2;
      o = "";
    } else if (o === "\u0E08\u0E23") {
      specialInitial = "ch"; // จริง → ching (the ร is silent)
      stackCut = 2;
      o = "";
    } else if (o.startsWith("\u0E2B") && o.length > 1 && SONORANTS.has(o[1])) {
      // ห+sonorant: the ห only marks tone (ไหน → nai); drop it.
      o = o.slice(1);
      stackCut = 1;
    }

    // Carrier อ: silent when it opens a syllable (อา, อี, อยู่, อวน).
    if (o.startsWith(O_O)) {
      if (!pendingLead && !hasVowel && o[1] === W_W) {
        // อ้วน → uan, อวย → uai: the อ is silent before the ว diphthong.
        result += o[2] === Y_Y ? "uai" : "ua";
        if (o.length >= 3 && o[2] !== Y_Y) result += finalOf(o[2]);
        continue;
      }
      if (pendingLead) {
        // เอก → ek, เอา handled by vowel above when า follows.
        const leadValue = resolveLead(pendingLead, undefined, undefined).value;
        if (o.length === 1) {
          o = "";
        } else {
          result += leadValue + finalOf(o[1]);
          if (o.length > 2) result += initialOf(o[2]);
          continue;
        }
      } else if (hasVowel) {
      // Carrier อ takes its vowel: อาบ → ap, อีก → ik, แต่ อร่อย → aroi
      // (the อ-as-vowel reads as implicit a).
      result += (v === O_O ? "a" : vowel) ?? "a";
      i = stackStart + 1;
      while (i < n && !isConsonant(chars[i]) && !VOWEL_LEAD[chars[i]]) i++;
      const runStart = i;
      while (i < n && isConsonant(chars[i])) i++;
      const run = chars.slice(runStart, i);
      if (run.length === 1 && !SONORANTS.has(run[0])) {
        // อาบ → ap, อีก → ik when final; อาหาร → a + han when a vowel follows.
        if (i < n && isVowelStart(chars[i])) {
          i = runStart;
        } else {
          result += finalOf(run[0]);
        }
      } else if (run.length === 1) {
        // Sonorant after the carrier vowel: อ่าน → an, อร่อย → a + roi.
        if (i < n) {
          i = runStart;
        } else {
          result += finalOf(run[0]);
        }
      } else if (run.length >= 3 && !SONORANTS.has(run[0])) {
        // อักษร → ak + son: a word-final stop run closes it.
        result += finalOf(run[0]);
        i = runStart + 1;
      } else {
        // อร่อย → a + roi, อารมณ์ → a + rom: rescan from the run.
        i = runStart;
      }
      continue;
    } else if (o.length === 2) {
        // อน → on, อบ → op
        result += "o" + finalOf(o[1]);
        continue;
      } else if (o.length >= 3) {
        // อักษร → akson
        result += "a" + finalOf(o[1]) + initialOf(o[2]);
        if (o.length > 3) result += "o" + finalOf(o[3]);
        continue;
      }
      // Single อ, no vowel: bare o (อ → o)
      o = "";
    }

    if (!hasVowel) {
      // Reduced vowel-less pairs and implicit vowels.
      if (!pendingLead && o.length >= 2 && o[1] === W_W) {
        // [X, ว, Z] → Xua/uai: สวย → suai, ชวน → chuan, ควย → khuai
        result += specialInitial ?? initialOf(o[0]);
        result += o[2] === Y_Y ? "uai" : "ua";
        if (o.length >= 3 && o[2] !== Y_Y) result += finalOf(o[2]);
        continue;
      }
      if (pendingLead && o.length >= 2) {
        // Leading vowel with silent vowel glyph: ไทย → thai, แกง → kaeng,
        // เลย → loei. The last consonant closes the syllable.
        const last = o[o.length - 1];
        const lead = resolveLead(pendingLead, last === Y_Y ? Y_Y : undefined, undefined).value;
        const cluster = CLUSTER_PAIRS.has(o.slice(0, 2)) && o[1] !== W_W;
        result += (cluster ? initialOf(o[0]) + initialOf(o[1]) : initialOf(o[0])) + lead;
        if (last === Y_Y) {
          if (!lead.endsWith("i")) result += "i";
        } else if (cluster && o.length === 2) {
          // แกล → klae: the whole cluster opens the syllable.
        } else if (last === W_W && lead === "ae") {
          result += "o"; // แก้ว → kaeo, แล้ว → laeo
        } else if (!cluster || o.length > 2) {
          result += finalOf(last); // เพลง → phleng
        }
        continue;
      }
      if (o.length === 1) {
        if (pendingLead) {
          const leadValue = pendingLead === "\u0E40" ? "e" : VOWEL_LEAD[pendingLead];
          result += initialOf(o[0]) + leadValue;
        } else {
          // Bare consonant: Thai letter names and short-o syllables
          // (ก → ko, ก็ → ko).
          result += (specialInitial ?? initialOf(o[0])) + "o";
        }
        continue;
      }
      if (o.length === 2) {
        // นคร → nakhon, รถ → rot, หก → hok
        result += (specialInitial ?? initialOf(o[0])) + "o" + finalOf(o[1]);
        continue;
      }
      if (o.length >= 3) {
        // กนก → kanok
        result += (specialInitial ?? initialOf(o[0])) + "a" + initialOf(o[1]) + "o" + finalOf(o[2]);
        continue;
      }
    }

    // --- Vowel present ---
    let initial = specialInitial ?? "";
    if (o.length > 0) {
      if (CLUSTER_PAIRS.has(o.slice(0, 2))) {
        initial += initialOf(o[0]) + initialOf(o[1]);
      } else if (o.length >= 3 && o[1] === W_W && !CLUSTER_PAIRS.has(o.slice(0, 2)) && !SONORANTS.has(o[0])) {
        // สวยงาม → suai + ngam: the X-ว diphthong survives inside compounds
        // (non-cluster onsets only: ความ keeps its คว cluster).
        result += initialOf(o[0]) + (o[2] === Y_Y ? "uai" : "ua");
        i = stackStart + 3;
        continue;
      } else if (o.length > 1 && !SONORANTS.has(o[0]) && SONORANTS.has(o[1]) &&
          (v === O_O && isVowelStart(chars[i + 1])) || (pendingLead && o.length >= 3)) {
        // Sonorant after a stop spans the break: คนอื่น → khon + uen,
        // เช่นกัน → chen + kan: the sonorant closes the first syllable.
        result += initialOf(o[0]) + (pendingLead ? VOWEL_LEAD[pendingLead] : "o") + finalOf(o[1]);
        i = stackStart + 2 + stackCut;
        continue;
      } else if (o.length > 1) {
        // Non-cluster onset: a first consonant with a leading vowel of its
        // own keeps it (เวลา → we-la), otherwise implicit-a (ตลาด → ta-lat).
        const ownLead = pendingLead ? VOWEL_LEAD[pendingLead] : "a";
        result += initialOf(o[0]) + ownLead;
        i = stackStart + 1 + stackCut;
        continue;
      } else {
        initial += initialOf(o[0]);
      }
    }

    if (vowel) {
      result += initial + vowel;
    } else if (pendingLead && !hasVowel) {
      const lead = resolveLead(pendingLead, undefined, undefined).value;
      result += initial + lead;
    }
    if (consumed > 0) i += consumed;

    // --- Coda scan ---
    const codaStart = i;
    while (i < n && isConsonant(chars[i])) {
      i++;
    }
    const coda = chars.slice(codaStart, i);
    if (coda.length === 0) continue;

    const nextIsVowel = i < n && isVowelStart(chars[i]);

    if (coda.length === 1) {
      const fc = coda[0];
      if (vowel === "am") {
        // ำ already contains the final m (ทำไม → tha + mai).
        i = codaStart;
      } else if (fc === Y_Y) {
        // Final ย: append i unless the vowel already ends in i.
        result += result.endsWith("i") ? "" : "i";
      } else if (fc === W_W) {
        // Final ว: สาว → sao, เลี้ยว → liao.
        const lastVowel = vowel ?? "";
        result += lastVowel === "a" || lastVowel === "ia" || lastVowel === "ao" ? "o" : lastVowel === "ua" ? "" : "w";
      } else if (nextIsVowel && !SONORANTS.has(fc) && !VOWEL_LEAD[chars[i]]) {
        // ที่สุด → thi + sut: a stop before an attached vowel opens the next
        // syllable; before a leading vowel it stays a coda (ขอบใจ → khop+chai).
        i = codaStart;
      } else {
        result += finalOf(fc);
      }
    } else {
      const a = coda[0];
      const b = coda[1];
      if (nextIsVowel) {
        // The coda stack spans the syllable break: ห+sonorant or sonorant+stop
        // belongs to the next syllable entirely; otherwise the first
        // consonant closes the current one (สุดท้าย → sut + thai).
        if (a === "\u0E2B" && SONORANTS.has(b)) {
          i = codaStart;
        } else if (SONORANTS.has(a) && !SONORANTS.has(b)) {
          if (a === "\u0E23") {
            // เกียรติ: silent ร, ต starts the next syllable.
            i = codaStart + 1;
          } else {
            // ของคุณ → khong + khun: the sonorant is a real final.
            result += finalOf(a);
            i = codaStart + 1;
          }
        } else {
          result += finalOf(a);
          i = codaStart + 1;
        }
      } else {
        // Word-internal cluster: จักร → chak (ร silent).
        if (coda.length >= 3) {
          // อักษร → ak + son: only the first closes the syllable.
          result += finalOf(a);
          i = codaStart + 1;
        } else if (SONORANTS.has(a) && !SONORANTS.has(b)) {
          result += finalOf(b);
        } else {
          result += finalOf(a);
        }
      }
    }

    // Progress invariant: no matter what input arrives, the scanner must
    // consume at least one character per iteration or we hang the client.
    if (i === iterStart && i < n) {
      result += chars[i];
      i++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Word segmentation (NewMM) + line-level romanization
// ---------------------------------------------------------------------------

let tokenizerPromise: Promise<NewmmTokenizer> | null = null;

function scriptBaseUrl(): string | undefined {
  try {
    const liveReload = document.getElementById("sc-js-injected") as HTMLScriptElement | null;
    if (liveReload?.src) return new URL(".", liveReload.src).href;
    for (const s of Array.from(document.querySelectorAll("script[src]"))) {
      if ((s as HTMLScriptElement).src.includes("vivid-lyrics")) {
        return new URL(".", (s as HTMLScriptElement).src).href;
      }
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

async function fetchThaiWords(): Promise<string[]> {
  const base = scriptBaseUrl();
  const url = base ? new URL("words_th.txt", base).href : "words_th.txt";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`words_th.txt fetch failed: ${res.status}`);
  const text = await res.text();
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Lazy NewMM tokenizer backed by the bundled dictionary asset. */
export function ensureThaiTokenizer(): Promise<NewmmTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const words = await fetchThaiWords();
      return NewmmTokenizer.fromWordList(words);
    })();
  }
  return tokenizerPromise;
}

/** Segment a pure-Thai run into words. Falls back to TCC units. */
export async function segmentThaiWords(text: string): Promise<ThaiSegments> {
  if (!text) return [];
  try {
    const tokenizer = await ensureThaiTokenizer();
    return tokenizer.segment(text);
  } catch {
    // Degraded mode: TCC chunking (syllable-ish units, no dictionary).
    const positions = tccPos(text);
    const out: string[] = [];
    let prev = 0;
    for (const pos of positions) {
      if (pos > prev) out.push(text.slice(prev, pos));
      prev = pos;
    }
    return out;
  }
}

/**
 * Romanize a line containing Thai: segment into words (spaced output) and
 * apply RTGS per word. Non-Thai runs (English, digits, punctuation) pass
 * through untouched.
 */
export async function romanizeThaiLine(text: string): Promise<string> {
  const parts = text.split(THAI_RUN);
  const runs = text.match(THAI_RUN) ?? [];
  const romanized = await Promise.all(
    runs.map(async (run) => {
      const fixed = run.replace(/\u0E2F\u0E25\u0E2F/g, "la"); // ฯลฯ → la
      const words = await segmentThaiWords(fixed);
      return words.map(romanizeThaiWord).filter(Boolean).join(" ");
    }),
  );
  let out = parts[0];
  for (let k = 0; k < romanized.length; k++) {
    out += romanized[k] + parts[k + 1];
  }
  return out;
}

export { THAI_RUN };
