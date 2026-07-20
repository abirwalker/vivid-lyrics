import { on, off, emit } from "../utils/events";

let showRomanized = false;
let hasRomanizedText = false;

export function getRomanize(): boolean {
  return showRomanized;
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
  hasRomanizedText = canRomanize;
  showRomanized = canRomanize;
  emit("romanize:change", showRomanized);
}

export function onRomanizeChange(cb: (show: boolean) => void): () => void {
  const id = on("romanize:change", cb);
  return () => off(id);
}
