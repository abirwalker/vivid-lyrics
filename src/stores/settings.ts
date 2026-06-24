import storage from "../utils/storage";

export type Settings = {
  glowIntensity: number;
  bounceStrength: number;
  spotlightProbability: number;
  backgroundMode: "dynamic" | "static" | "color" | "none";
  autoScroll: boolean;
  blurEnabled: boolean;
  romanization: boolean;
  fontSize: number;
  fontFamily: "default" | "spicy";
  hideNativeLyrics: boolean;
  controlsPosition: "top" | "bottom";
  centeredText: boolean;
  centeredTextCard: boolean;
  springEnabled: boolean;
  springIntensity: number;
  gradientDirection: "vertical" | "horizontal";
};

const defaults: Settings = {
  glowIntensity: 1.0,
  bounceStrength: 1.0,
  spotlightProbability: 0.15,
  backgroundMode: "none",
  autoScroll: true,
  blurEnabled: true,
  romanization: false,
  fontSize: 100,
  fontFamily: "default",
  hideNativeLyrics: true,
  controlsPosition: "top",
  centeredText: false,
  centeredTextCard: false,
  springEnabled: true,
  springIntensity: 1.0,
  gradientDirection: "vertical",
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
}

export function resetSettings(): void {
  current = { ...defaults };
  save();
}

load();
