import { transliterate } from "transliteration";
import { get } from "../stores/settings";

const CJK = /[\u4E00-\u9FFF]/;

const KUROMOJI_CDN = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

const DICT_FILES = [
  "base.dat.gz", "check.dat.gz",
  "tid.dat.gz", "tid_pos.dat.gz", "tid_map.dat.gz",
  "cc.dat.gz",
  "unk.dat.gz", "unk_pos.dat.gz", "unk_map.dat.gz",
  "unk_char.dat.gz", "unk_compat.dat.gz", "unk_invoke.dat.gz",
];

let kuroshiro: any = null;
let initPromise: Promise<any> | null = null;

// --- Progress toast ---
let progressEl: HTMLDivElement | null = null;
let filesLoaded = 0;

function showProgress(): void {
  if (progressEl) return;
  filesLoaded = 0;
  const el = document.createElement("div");
  el.id = "VL-DictProgress";
  el.attachShadow({ mode: "open" });
  el.shadowRoot!.innerHTML = `
    <style>
      :host { all: initial; position: fixed !important; bottom: 120px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 999999 !important; }
      .wrap { background: rgba(30,30,30,0.96); color: #fff; padding: 14px 28px; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 260px; }
      .text { white-space: nowrap; }
      .bar { width: 100%; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; overflow: hidden; }
      .fill { height: 100%; width: 0%; background: #a78bfa; border-radius: 2px; transition: width 0.25s ease; }
    </style>
    <div class="wrap">
      <span class="text">Loading Japanese dictionary (0/12)...</span>
      <div class="bar"><div class="fill"></div></div>
    </div>
  `;
  document.body.appendChild(el);
  progressEl = el;
  console.log("[VividLyrics] Dictionary download started");
}

function updateProgress(): void {
  filesLoaded++;
  const pct = Math.round((filesLoaded / DICT_FILES.length) * 100);
  const text = progressEl?.shadowRoot?.querySelector(".text");
  const fill = progressEl?.shadowRoot?.querySelector(".fill") as HTMLElement | null;
  if (text) text.textContent = `Loading Japanese dictionary (${filesLoaded}/${DICT_FILES.length})...`;
  if (fill) fill.style.width = `${pct}%`;
  console.log(`[VividLyrics] Dictionary: ${filesLoaded}/${DICT_FILES.length} files loaded (${pct}%)`);
}

function hideProgress(): void {
  const text = progressEl?.shadowRoot?.querySelector(".text");
  const fill = progressEl?.shadowRoot?.querySelector(".fill") as HTMLElement | null;
  if (text) text.textContent = "Japanese dictionary loaded!";
  if (fill) fill.style.width = "100%";
  setTimeout(() => {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  }, 1200);
  console.log("[VividLyrics] Dictionary download complete");
}

// --- Kuroshiro init with progress tracking ---
async function ensureKuroshiro(): Promise<any> {
  if (kuroshiro) return kuroshiro;
  if (!initPromise) {
    initPromise = (async () => {
      showProgress();
      filesLoaded = 0;

      const Kuroshiro = (await import("kuroshiro")).default;
      const KuromojiAnalyzer = (await import("kuroshiro-analyzer-kuromoji")).default;

      const t0 = performance.now();
      let cacheHits = 0;
      let freshDownloads = 0;

      // Monkey-patch XHR to track kuromoji dictionary downloads
      const OrigXHR = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes(KUROMOJI_CDN) || urlStr.includes("kuromoji")) {
          this.addEventListener("load", () => {
            if (urlStr.endsWith(".gz")) {
              const elapsed = performance.now() - t0;
              const entry = performance.getEntriesByName(urlStr).pop() as any;
              const fromCache = entry?.transferSize === 0 && entry?.decodedBodySize > 0;
              if (fromCache) cacheHits++;
              else freshDownloads++;
              console.log(`[VividLyrics] Dict ${urlStr.split("/").pop()}: ${fromCache ? "CACHED" : "FRESH"} (${Math.round(elapsed)}ms)`);
              updateProgress();
            }
          });
        }
        return OrigXHR.call(this, method, url, ...rest);
      };

      try {
        const k = new Kuroshiro();
        const analyzer = new KuromojiAnalyzer({ dictPath: KUROMOJI_CDN });
        await k.init(analyzer);
        kuroshiro = k;
        const total = performance.now() - t0;
        console.log(`[VividLyrics] Kuroshiro ready in ${Math.round(total)}ms — ${cacheHits} cached, ${freshDownloads} fresh`);
        hideProgress();
        return k;
      } catch (e) {
        console.error("[VividLyrics] Kuroshiro init failed:", e);
        hideProgress();
        throw e;
      } finally {
        XMLHttpRequest.prototype.open = OrigXHR;
      }
    })();
  }
  return initPromise;
}

export async function romanizeJP(text: string): Promise<string> {
  if (!text) return text;
  try {
    const k = await ensureKuroshiro();
    return await k.convert(text, { to: "romaji", mode: "spaced" });
  } catch {
    return text;
  }
}

export function romanizeText(text: string): string {
  if (!text) return text;
  if (CJK.test(text)) return text;
  return transliterate(text, { fixChineseSpacing: true });
}

const KATAKANA_RE = /^[\u30A0-\u30FF\u30FC]+$/;

let wanakana: any = null;
async function ensureWanakana() {
  if (!wanakana) wanakana = await import("wanakana");
  return wanakana;
}

async function buildFuriganaMap(fullText: string): Promise<Map<number, string>> {
  const k = await ensureKuroshiro();
  const html: string = await k.convert(fullText, { to: "hiragana", mode: "furigana" });

  const map = new Map<number, string>();
  let offset = 0;
  const stripped = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const rubyRe = /<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = rubyRe.exec(stripped))) {
    if (m[1] !== undefined) {
      map.set(offset, m[2]);
      offset += [...m[1]].length;
    } else if (m[3] !== undefined) {
      offset += [...m[3]].length;
    }
  }

  if (map.size === 0 && /[\u4E00-\u9FFF]/.test(fullText)) {
    console.log("[VividLyrics][furigana] WARNING: empty map for kanji-containing line, raw html:", html);
  }
  return map;
}

let standaloneTokenizer: any = null;

export async function tokenizeAndRomanizeFullLine(
  fullText: string,
): Promise<{ tokenReadings: { text: string; romaji: string }[] }> {
  await ensureKuroshiro();

  if (!standaloneTokenizer) {
    try {
      const kuromoji = await import("kuromoji");
      standaloneTokenizer = await new Promise<any>((resolve, reject) => {
        kuromoji.default.builder({ dicPath: KUROMOJI_CDN }).build((err: any, tokenizer: any) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
      });
      console.log("[VividLyrics] Standalone kuromoji tokenizer ready");
    } catch (e) {
      console.error("[VividLyrics] Standalone tokenizer failed, falling back:", e);
      return { tokenReadings: [{ text: fullText, romaji: await romanizeJP(fullText) }] };
    }
  }

  const tokens: any[] = standaloneTokenizer.tokenize(fullText);
  const wk = await ensureWanakana();
  const furiganaMap = await buildFuriganaMap(fullText);
  console.log("[VividLyrics][furigana] map for line:", fullText, Array.from(furiganaMap.entries()));

  const tokenReadings: { text: string; romaji: string }[] = [];
  let tokenStartOffset = 0;
  for (const tok of tokens) {
    const surface = tok.surface_form ?? "";
    const reading = tok.reading ?? "";
    let romaji: string;
    if (reading && KATAKANA_RE.test(reading)) {
      const toRomaji = wk.toRomaji ?? wk.default?.toRomaji;
      romaji = toRomaji ? toRomaji(reading) : await romanizeJP(reading);
    } else if (surface) {
      const furiganaReading = furiganaMap.get(tokenStartOffset) ?? null;
      const validFurigana = furiganaReading && furiganaReading !== surface ? furiganaReading : null;
      if (validFurigana) {
        const toRomaji = wk.toRomaji ?? wk.default?.toRomaji;
        romaji = toRomaji ? toRomaji(furiganaReading) : await romanizeJP(surface);
      } else {
        romaji = await romanizeJP(surface);
      }
      const logSource = validFurigana ? `furigana:${validFurigana}` : furiganaReading ? `rejected(same as surface)` : `miss`;
      console.log("[VividLyrics][furigana] token:", JSON.stringify(surface), "offset:", tokenStartOffset, "source:", logSource, "final romaji:", romaji);
    } else {
      romaji = surface;
    }
    tokenReadings.push({ text: surface, romaji });
    tokenStartOffset += [...surface].length;
  }
  return { tokenReadings };
}
