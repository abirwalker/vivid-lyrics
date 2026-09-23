import { on, off, emit } from "../utils/events";
import { get } from "./settings";

let showRomanized = false;
let hasRomanizedText = false;

export function getRomanize(): boolean {
  return showRomanized && get("romanization");
}

export function hasRomanizeCapability(): boolean {
  return hasRomanizedText;
}

export function setRomanize(value: boolean): void {
  showRomanized = value;
  emit("romanize:change", showRomanized);
}

export function toggleRomanize(): void {
  setRomanize(!showRomanized);
}

export function resetRomanize(canRomanize: boolean): void {
  const wasCapable = hasRomanizedText;
  hasRomanizedText = canRomanize;
  let changed = wasCapable !== canRomanize;

  if (!canRomanize) {
    if (showRomanized) {
      showRomanized = false;
      changed = true;
    }
  } else if (!wasCapable && get("romanization") && !showRomanized) {
    showRomanized = true;
    changed = true;
  }

  if (changed) emit("romanize:change", showRomanized);
}

export function onRomanizeChange(cb: (show: boolean) => void): () => void {
  const id = on("romanize:change", cb);
  return () => off(id);
}
