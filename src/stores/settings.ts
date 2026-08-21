import storage from "../utils/storage";
import { on, off, emit } from "../utils/events";

export type Settings = {
  accentColor: boolean;
  bloomColor: boolean;
  glowIntensity: number;
  bounceStrength: number;
  spotlightProbability: number;
  backgroundMode: "dynamic" | "static" | "color" | "none";
  autoScroll: boolean;
  blurEnabled: boolean;
  blurStrength: "light" | "normal" | "heavy";
  romanization: boolean;
  romanizationPosition: "top" | "bottom" | "replace";
  fontSize: number;
  fontFamily: "default" | "spicy" | "outfit" | "crimson-pro" | "jetbrains-mono" | "patrick-hand" | "custom";
  customFontName: string;
  hideNativeLyrics: boolean;
  controlsPosition: "top" | "bottom";
  centeredText: boolean;
  centeredTextCard: boolean;
  animationStyle: "spicy-bounce" | "wobble";
  springMode: "legacy" | "current";
  springIntensity: number;
  gradientDirection: "vertical" | "horizontal";
  cardHeight: number;
  cardScrollMode: "static" | "gentle" | "active";
  wordSeekEnabled: boolean;
  scrollMode: "smooth" | "legacy";
  stripBackgroundBrackets: boolean;
  npvAmbiance: boolean;
  mainPlayerWidget: boolean;
  fullscreenPlayerWidget: boolean;
  autoResumeDelay: number;
};

const defaults: Settings = {
  accentColor: true,
  bloomColor: true,
  glowIntensity: 1.0,
  bounceStrength: 1.0,
  spotlightProbability: 0.15,
  backgroundMode: "dynamic",
  autoScroll: true,
  blurEnabled: true,
  blurStrength: "normal",
  romanization: true,
  romanizationPosition: "replace",
  fontSize: 100,
  fontFamily: "default",
  customFontName: "",
  hideNativeLyrics: true,
  controlsPosition: "top",
  centeredText: false,
  centeredTextCard: false,
  animationStyle: "spicy-bounce",
  springMode: "current",
  springIntensity: 1.0,
  gradientDirection: "vertical",
  cardHeight: 340,
  cardScrollMode: "static",
  wordSeekEnabled: true,
  scrollMode: "smooth",
  stripBackgroundBrackets: false,
  npvAmbiance: true,
  mainPlayerWidget: false,
  fullscreenPlayerWidget: true,
  autoResumeDelay: 10,
};

let current: Settings = { ...defaults };

export type SettingsChange = {
  key: keyof Settings | null;
};

export function onSettingsChange(cb: (change: SettingsChange) => void): () => void {
  const id = on("settings:change", cb);
  return () => off(id);
}

function load(): void {
  try {
    const raw = storage.get("settings");
    if (raw) {
      current = { ...defaults, ...JSON.parse(raw) };
    }
  } catch {}
}

function save(): void {
  storage.set("settings", JSON.stringify(current));
}

export function getSettings(): Settings {
  return current;
}

export function get<K extends keyof Settings>(key: K): Settings[K] {
  return current[key];
}

export function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (current[key] === value) return;
  current[key] = value;
  save();
  emit("settings:change", { key });
  if (process.env.NODE_ENV === "development") {
    devNotify(key, value);
  }
}

function devNotify(key: string, value: unknown): void {
  const el = document.getElementById("VL-DevSettingsToast");
  if (el) el.remove();

  const toast = document.createElement("div");
  toast.id = "VL-DevSettingsToast";
  toast.className = "VL-DevSettingsToast";
  toast.innerHTML = `<span class="VL-DevKey">${key}</span><span class="VL-DevVal">${JSON.stringify(value)}</span>`;

  // inject styles once
  if (!document.getElementById("VL-DevSettingsStyle")) {
    const s = document.createElement("style");
    s.id = "VL-DevSettingsStyle";
    s.textContent = `
      .VL-DevSettingsToast {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(12px);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 20px;
        border-radius: 8px;
        background: rgba(40, 40, 40, 0.95);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 13px;
        color: #fff;
        opacity: 0;
        animation: VL-SetIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards,
                   VL-SetOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) 2s forwards;
      }
      .VL-DevKey {
        color: #a78bfa;
        font-weight: 600;
      }
      .VL-DevVal {
        color: #34d399;
      }
      @keyframes VL-SetIn { to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      @keyframes VL-SetOut { to { opacity: 0; transform: translateX(-50%) translateY(12px); } }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

export function resetSettings(): void {
  current = { ...defaults };
  save();
  emit("settings:change", { key: null });
}

load();
