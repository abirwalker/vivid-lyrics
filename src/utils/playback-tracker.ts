let rafId = 0;
let listeners: Array<(ms: number) => void> = [];
let running = false;

function tick(): void {
  if (!running) return;
  const ms = Spicetify.Player.getProgress();
  for (const cb of listeners) cb(ms);
  rafId = requestAnimationFrame(tick);
}

export function startTracking(): void {
  if (running) return;
  running = true;
  rafId = requestAnimationFrame(tick);
}

export function stopTracking(): void {
  if (running) return;
  running = false;
  cancelAnimationFrame(rafId);
}

export function onPositionChange(cb: (ms: number) => void): () => void {
  listeners.push(cb);
  if (running === false) startTracking();
  return () => {
    listeners = listeners.filter((fn) => fn !== cb);
    if (listeners.length === 0) stopTracking();
  };
}
