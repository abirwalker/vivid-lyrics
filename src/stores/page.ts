import { on, off, emit } from "../utils/events";

export type PageMode = "page" | "cinema" | "fullscreen";

let currentMode: PageMode = "page";

export function getPageMode(): PageMode {
  return currentMode;
}

export function isPage(): boolean {
  return currentMode === "page";
}

export function isCinema(): boolean {
  return currentMode === "cinema";
}

export function isFullscreen(): boolean {
  return currentMode === "fullscreen";
}

export function onPageModeChange(cb: (mode: PageMode) => void): () => void {
  const id = on("page:mode", cb);
  return () => off(id);
}

export function setPageMode(mode: PageMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  emit("page:mode", mode);
}
