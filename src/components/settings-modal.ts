import {
  getSettings,
  get,
  set,
  resetSettings,
  type Settings,
} from "../stores/settings";
import storage from "../utils/storage";
import "../styles/settings.scss";

const FONT_CSS_URL = "https://fonts.spikerko.org/spicy-lyrics/source.css";
const CACHE_KEY = "spicy-font-css";
let injected = false;

async function ensureSpicyFont(): Promise<void> {
  if (injected) return;

  const cached = storage.get(CACHE_KEY);
  if (cached) {
    injectFontCSS(cached);
    injected = true;
    return;
  }

  const cssRes = await fetch(FONT_CSS_URL);
  const rawCSS = await cssRes.text();

  const fontMatches = [...rawCSS.matchAll(/url\(([^)]+)\)/g)];
  let resolved = rawCSS;

  for (const match of fontMatches) {
    const relativePath = match[1];
    const absoluteURL = new URL(relativePath, FONT_CSS_URL).href;
    const fontRes = await fetch(absoluteURL);
    const buffer = await fontRes.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
    );
    const dataURL = `data:font/woff2;base64,${base64}`;
    resolved = resolved.replace(match[0], `url(${dataURL})`);
  }

  storage.set(CACHE_KEY, resolved);
  injectFontCSS(resolved);
  injected = true;
}

function injectFontCSS(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

function applyFont(font: Settings["fontFamily"]): void {
  document.documentElement.classList.remove("vl-font-default", "vl-font-spicy");
  document.documentElement.classList.add(`vl-font-${font}`);
  if (font === "spicy") {
    ensureSpicyFont();
  }
}

function applyCenteredText(centered: boolean): void {
  document.documentElement.classList.toggle("vl-centered-text", centered);
}

function applyCenteredTextCard(centered: boolean): void {
  document
    .getElementById("VividLyrics-Card")
    ?.classList.toggle("vl-card-centered", centered);
}

export function applyStoredFont(): void {
  applyFont(get("fontFamily"));
  applyNativeLyricsVisibility(get("hideNativeLyrics"));
  applyCenteredText(get("centeredText"));
  applyCenteredTextCard(get("centeredTextCard"));
}

function applyNativeLyricsVisibility(hide: boolean): void {
  let style = document.getElementById(
    "VL-native-lyrics-css",
  ) as HTMLStyleElement;
  if (!style) {
    style = document.createElement("style");
    style.id = "VL-native-lyrics-css";
    document.head.appendChild(style);
  }
  style.textContent = hide
    ? `.main-nowPlayingBar-lyricsButton { display: none !important; }`
    : "";
}

let overlay: HTMLDivElement | null = null;
let isOpen = false;

function makeRow(
  label: string,
  desc: string,
  control: HTMLElement,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "VL-Row";

  const info = document.createElement("div");
  info.className = "VL-RowInfo";
  const l = document.createElement("span");
  l.className = "VL-RowLabel";
  l.textContent = label;
  info.appendChild(l);
  if (desc) {
    const d = document.createElement("span");
    d.className = "VL-RowDesc";
    d.textContent = desc;
    info.appendChild(d);
  }

  const ctrl = document.createElement("div");
  ctrl.className = "VL-RowControl";
  ctrl.appendChild(control);

  row.appendChild(info);
  row.appendChild(ctrl);
  return row;
}

function makeSlider(
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onChange(parseFloat(input.value)));
  return input;
}

function makeToggle(
  active: boolean,
  onChange: (v: boolean) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `VL-Toggle${active ? " active" : ""}`;
  btn.addEventListener("click", () => {
    const next = !btn.classList.contains("active");
    btn.classList.toggle("active", next);
    onChange(next);
  });
  return btn;
}

function makeSelect(
  options: { label: string; value: string }[],
  current: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    o.selected = opt.value === current;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function makeSoon(): HTMLElement {
  const el = document.createElement("span");
  el.className = "VL-Soon";
  el.textContent = "SOON\u2122";
  return el;
}

function buildContent(): HTMLElement {
  const s = getSettings();
  const content = document.createElement("div");
  content.className = "VL-Content";

  const sections: Record<
    string,
    { label: string; desc: string; control: HTMLElement }[]
  > = {
    Lyrics: [
      {
        label: "Auto-scroll",
        desc: "Scroll to active line",
        control: makeToggle(s.autoScroll, (v) => set("autoScroll", v)),
      },
      {
        label: "Centered Text",
        desc: "Center-align lyrics in main and cinema view",
        control: makeToggle(s.centeredText, (v) => {
          set("centeredText", v);
          applyCenteredText(v);
        }),
      },
      {
        label: "Centered Text for NPV",
        desc: "Center-align lyrics in Now Playing View's card-view mode",
        control: makeToggle(s.centeredTextCard, (v) => {
          set("centeredTextCard", v);
          applyCenteredTextCard(v);
        }),
      },
      {
        label: "Font Size",
        desc: "Lyrics text size",
        control: makeSelect(
          [
            { label: "Small", value: "90" },
            { label: "Normal", value: "100" },
            { label: "Large", value: "120" },
          ],
          String(s.fontSize),
          (v) => set("fontSize", Number(v)),
        ),
      },
      {
        label: "Font",
        desc: "Lyrics typeface",
        control: makeSelect(
          [
            { label: "Default", value: "default" },
            { label: "Spicy", value: "spicy" },
          ],
          s.fontFamily,
          (v) => {
            set("fontFamily", v as Settings["fontFamily"]);
            applyFont(v as Settings["fontFamily"]);
          },
        ),
      },
      {
        label: "Spicy Spring",
        desc: "Bouncy syllable animation",
        control: makeToggle(s.springEnabled, (v) => set("springEnabled", v)),
      },
      {
        label: "Spring Version",
        desc: "Animation tuning style",
        control: makeSelect(
          [
            { label: "Legacy", value: "legacy" },
            { label: "Current", value: "current" },
          ],
          s.springMode,
          (v) => set("springMode", v as "legacy" | "current"),
        ),
      },
      {
        label: "Line Gradient Direction",
        desc: "Direction of the highlight sweep",
        control: makeSelect(
          [
            { label: "Top to Bottom", value: "vertical" },
            { label: "Left to Right", value: "horizontal" },
          ],
          s.gradientDirection,
          (v) => set("gradientDirection", v as Settings["gradientDirection"]),
        ),
      },
      {
        label: "Spring Intensity",
        desc: "Motion strength (0-2x)",
        control: makeSlider(0, 2, 0.1, s.springIntensity, (v) =>
          set("springIntensity", v),
        ),
      },
      {
        label: "Card Height",
        desc: "NPV card max height in pixels",
        control: makeSlider(200, 600, 10, s.cardHeight, (v) => {
          set("cardHeight", v);
          document.getElementById("VividLyrics-Card")?.style.setProperty("--vl-card-height", `${v}px`);
        }),
      },
      {
        label: "Card Scroll",
        desc: "How NPV card follows lyrics",
        control: makeSelect(
          [
            { label: "Static", value: "static" },
            { label: "Gentle", value: "gentle" },
            { label: "Active", value: "active" },
          ],
          s.cardScrollMode,
          (v) => set("cardScrollMode", v as Settings["cardScrollMode"]),
        ),
      },
    ],
    Background: [
      {
        label: "Mode",
        desc: "Background style",
        control: makeSelect(
          [
            { label: "None", value: "none" },
            { label: "Static", value: "static" },
            { label: "Dynamic", value: "dynamic" },
            { label: "Color", value: "color" },
          ],
          s.backgroundMode,
          (v) => set("backgroundMode", v as Settings["backgroundMode"]),
        ),
      },
    ],
    Interface: [
      {
        label: "Hide Spotify Lyrics Button",
        desc: "Hide the native lyrics button in the playbar",
        control: makeToggle(s.hideNativeLyrics, (v) => {
          set("hideNativeLyrics", v);
          applyNativeLyricsVisibility(v);
        }),
      },
      {
        label: "Toolbar Position",
        desc: "Cinema overlay controls",
        control: makeSelect(
          [
            { label: "Top", value: "top" },
            { label: "Bottom", value: "bottom" },
          ],
          s.controlsPosition,
          (v) => set("controlsPosition", v as Settings["controlsPosition"]),
        ),
      },
    ],
    "Coming Soon": [
      {
        label: "Glow Intensity",
        desc: "Strength of the glow effect",
        control: makeSlider(0, 2, 0.1, s.glowIntensity, (v) =>
          set("glowIntensity", v),
        ),
      },
      {
        label: "Spotlight Words",
        desc: "Random words get highlighted",
        control: makeSoon(),
      },
      {
        label: "Blur Effect",
        desc: "Blur distant lyrics",
        control: (() => {
          const blurStrengthRow = makeRow(
            "Blur Strength",
            "How much blur to apply",
            makeSelect(
              [
                { label: "Light", value: "light" },
                { label: "Normal", value: "normal" },
                { label: "Heavy", value: "heavy" },
              ],
              s.blurStrength,
              (v) => set("blurStrength", v as Settings["blurStrength"]),
            ),
          );
          blurStrengthRow.style.display = s.blurEnabled ? "" : "none";
          blurStrengthRow.classList.add("VL-BlurStrength");

          const toggle = makeToggle(s.blurEnabled, (v) => {
            set("blurEnabled", v);
            blurStrengthRow.style.display = v ? "" : "none";
          });

          // inject the strength row after the toggle row at build time
          (toggle as any)._blurStrengthRow = blurStrengthRow;
          return toggle;
        })(),
      },
      {
        label: "Romanization",
        desc: "Show romanized text",
        control: makeSoon(),
      },
    ],
  };

  for (const [sectionTitle, rows] of Object.entries(sections)) {
    const section = document.createElement("div");
    section.className = "VL-Section";

    const title = document.createElement("h3");
    title.className = "VL-SectionTitle";
    title.textContent = sectionTitle;
    section.appendChild(title);

    for (const row of rows) {
      const el = makeRow(row.label, row.desc, row.control);
      section.appendChild(el);
      // inject nested blur strength row after blur toggle
      const nested = (row.control as any)?._blurStrengthRow;
      if (nested) section.appendChild(nested);
    }

    content.appendChild(section);
  }

  const resetRow = document.createElement("div");
  resetRow.className = "VL-Section";
  const resetBtn = document.createElement("button");
  resetBtn.className = "VL-ResetBtn";
  resetBtn.textContent = "Reset to Defaults";
  resetBtn.addEventListener("click", () => {
    resetSettings();
    closeModal();
    openModal();
  });
  resetRow.appendChild(resetBtn);
  content.appendChild(resetRow);

  const version = document.createElement("div");
  version.className = "VL-Version";
  version.textContent = "Vivid Lyrics v0.1.0";
  content.appendChild(version);

  return content;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isOpen) {
    closeModal();
  }
}

export function openModal(): void {
  if (isOpen) return;
  isOpen = true;

  overlay = document.createElement("div");
  overlay.className = "VL-SettingsOverlay";

  const modal = document.createElement("div");
  modal.className = "VL-SettingsModal";

  const header = document.createElement("header");
  const h2 = document.createElement("h2");
  h2.textContent = "Settings";
  header.appendChild(h2);

  const closeBtn = document.createElement("button");
  closeBtn.className = "VL-CloseBtn";
  closeBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>`;
  closeBtn.addEventListener("click", closeModal);
  header.appendChild(closeBtn);

  modal.appendChild(header);
  modal.appendChild(buildContent());
  overlay.appendChild(modal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKeyDown);
}

export function closeModal(): void {
  if (!isOpen) return;
  isOpen = false;
  overlay?.remove();
  overlay = null;
  document.removeEventListener("keydown", onKeyDown);
}

export function setupSettings(): void {
  // styles loaded via settings.scss import
}
