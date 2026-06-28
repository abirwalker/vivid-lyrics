import storage from "../utils/storage";

export type Settings = {
  glowIntensity: number;
  bounceStrength: number;
  spotlightProbability: number;
  backgroundMode: "dynamic" | "static" | "color" | "none";
  autoScroll: boolean;
  blurEnabled: boolean;
  blurStrength: "light" | "normal" | "heavy";
  romanization: boolean;
  fontSize: number;
  fontFamily: "default" | "spicy";
  hideNativeLyrics: boolean;
  controlsPosition: "top" | "bottom";
  centeredText: boolean;
  centeredTextCard: boolean;
  springEnabled: boolean;
  springMode: "legacy" | "current";
  springIntensity: number;
  gradientDirection: "vertical" | "horizontal";
  cardHeight: number;
  cardScrollMode: "static" | "gentle" | "active";
  wordSeekEnabled: boolean;
};

const defaults: Settings = {
  glowIntensity: 1.0,
  bounceStrength: 1.0,
  spotlightProbability: 0.15,
  backgroundMode: "none",
  autoScroll: true,
  blurEnabled: true,
  blurStrength: "normal",
  romanization: false,
  fontSize: 100,
  fontFamily: "default",
  hideNativeLyrics: true,
  controlsPosition: "top",
  centeredText: false,
  centeredTextCard: false,
  springEnabled: true,
  springMode: "current",
  springIntensity: 1.0,
  gradientDirection: "vertical",
  cardHeight: 340,
  cardScrollMode: "static",
  wordSeekEnabled: true,
};

let current: Settings = { ...defaults };

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
  current[key] = value;
  save();
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
}

load();
