import __wbg_init, { TokenizerBuilder } from "lindera-wasm-web-unidic";

let tokenizer: any = null;
let initPromise: Promise<any> | null = null;

let progressEl: HTMLDivElement | null = null;

/** The `@spicemod/creator` dev pipeline injects the extension as a classic
 *  `<script>` (`sc-js-injected`). Resolve the WASM asset relative to that
 *  script's own URL so the dev server can serve it. */
function getWasmUrl(): string | undefined {
  try {
    const liveReload = document.getElementById("sc-js-injected") as HTMLScriptElement | null;
    if (liveReload?.src) return new URL("lindera_wasm_bg.wasm", liveReload.src).href;
    for (const s of Array.from(document.querySelectorAll("script[src]"))) {
      if ((s as HTMLScriptElement).src.includes("vivid-lyrics")) {
        return new URL("lindera_wasm_bg.wasm", (s as HTMLScriptElement).src).href;
      }
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

function showProgress(): void {
  if (progressEl) return;
  const el = document.createElement("div");
  el.id = "VL-DictProgress";
  el.attachShadow({ mode: "open" });
  el.shadowRoot!.innerHTML = `
    <style>
      :host { all: initial; position: fixed !important; bottom: 120px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 999999 !important; }
      .wrap { background: rgba(30,30,30,0.96); color: #fff; padding: 14px 28px; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 260px; }
      .text { white-space: nowrap; }
      .bar { width: 100%; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; overflow: hidden; }
      .fill { height: 100%; width: 50%; background: #a78bfa; border-radius: 2px; transition: width 0.25s ease; }
    </style>
    <div class="wrap">
      <span class="text">Loading Japanese dictionary (UniDic)...</span>
      <div class="bar"><div class="fill"></div></div>
    </div>
  `;
  document.body.appendChild(el);
  progressEl = el;
  console.log("[VividLyrics] Lindera WASM initialization started");
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
  console.log("[VividLyrics] Lindera WASM initialization complete");
}

export interface LinderaToken {
  surface: string;
  /** Katakana reading of the surface form (語形出現形), e.g. 忘れ → ワスレ. */
  phonologicalSurfaceForm?: string;
  /** Lexeme reading (語彙素読み) — dictionary form, may include inflections. */
  reading?: string;
  partOfSpeech: string;
  partOfSpeechSubcategory1: string;
}

/**
 * Get the reading (katakana) of a token, or null when unavailable.
 * Prefers `phonologicalSurfaceForm` (語形出現形 — the pronunciation of the
 * surface form, e.g. 忘れ→ワスレ) over `reading` (語彙素読み — the lexeme
 * reading, e.g. 忘れ→ワスレル), which includes inflections not present in
 * the surface. Falls back to null when neither is usable.
 */
export function getReading(token: LinderaToken): string | null {
  const reading = token?.phonologicalSurfaceForm || token?.reading;
  if (!reading || reading === "*") return null;
  return reading;
}

export function getPos(token: LinderaToken): string {
  return token?.partOfSpeech ?? "";
}

export function getPosDetail1(token: LinderaToken): string {
  return token?.partOfSpeechSubcategory1 ?? "";
}

export async function ensureLindera(): Promise<any> {
  if (tokenizer) return tokenizer;
  if (!initPromise) {
    initPromise = (async () => {
      showProgress();
      try {
        const wasmUrl = getWasmUrl();
        if (wasmUrl) {
          await __wbg_init(wasmUrl);
        } else {
          await __wbg_init();
        }
        const builder = new TokenizerBuilder();
        builder.setMode("normal");
        builder.setDictionary("embedded://unidic");
        tokenizer = builder.build();
      } finally {
        hideProgress();
      }
      return tokenizer;
    })();
  }
  return initPromise;
}

export function tokenize(text: string): LinderaToken[] {
  if (!tokenizer) throw new Error("Lindera not initialized");
  return tokenizer.tokenize(text);
}
