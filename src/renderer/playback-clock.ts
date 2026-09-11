import {
  incrementPerformanceCounter,
  markPerformanceEvent,
  recordPerformanceDuration,
} from "../tools/performance-logger";

let syncedPosition = 0; // seconds
let syncedAt = 0; // performance.now() ms
let predictedPosition = 0; // seconds
let lastPredictTime = 0; // performance.now() ms
let lastTrackUri: string | null = null;
let durationSeconds = 0;
let syncTimeoutId: ReturnType<typeof setTimeout> | null = null;

const SEEK_SNAP_THRESHOLD_S = 0.5;
// Progress events stop while paused; this also picks up paused seeks.
const SYNC_INTERVAL_MS = 1000;

function getTrackUri(): string | null {
  return Spicetify.Player?.data?.item?.uri ?? null;
}

function readDuration(): number {
  const durationMs =
    Spicetify.Player?.getDuration?.() ??
    (Spicetify.Player?.data?.item as any)?.duration?.milliseconds ??
    0;
  return Math.max(0, durationMs / 1000);
}

function clampToTrack(position: number): number {
  const nonNegative = Math.max(0, position);
  return durationSeconds > 0 ? Math.min(nonNegative, durationSeconds) : nonNegative;
}

function seedFromPlayer(): void {
  const rawPosition = (Spicetify.Player?.getProgress?.() ?? 0) / 1000;
  const now = performance.now();

  lastTrackUri = getTrackUri();
  durationSeconds = readDuration();
  syncedPosition = clampToTrack(rawPosition);
  syncedAt = now;
  predictedPosition = syncedPosition;
  lastPredictTime = now;
}

/** Sample the same player timeline used by progress events and lyric seeks. */
export async function syncPlaybackPosition(): Promise<void> {
  markPerformanceEvent("playbackClock.sync.start");
  const player = Spicetify.Player;
  if (!player) return;

  const currentUri = getTrackUri();
  if (currentUri !== lastTrackUri) {
    seedFromPlayer();
  }

  const requestStartedAt = performance.now();
  // getProgress already extrapolates Spotify's timestamped player state.
  // Mixing it with the private context position (without its timestamp/error)
  // lets two different timelines repeatedly undo each other's seek updates.
  const sampledPosition = (player.getProgress?.() ?? Number.NaN) / 1000;
  const sampledAt = performance.now();
  markPerformanceEvent("playbackClock.sync.complete");
  recordPerformanceDuration("playbackClock.sync", performance.now() - requestStartedAt);

  if (!Number.isFinite(sampledPosition)) return;

  durationSeconds = readDuration();
  syncedPosition = clampToTrack(sampledPosition);
  syncedAt = sampledAt;
}

function scheduleNextSync(): void {
  if (syncTimeoutId !== null) clearTimeout(syncTimeoutId);

  syncTimeoutId = setTimeout(async () => {
    await syncPlaybackPosition();
    scheduleNextSync();
  }, SYNC_INTERVAL_MS);
}

/** Reset immediately after playback discontinuities. */
export function resetPlaybackClock(): void {
  incrementPerformanceCounter("playbackClock.resets");
  seedFromPlayer();
  void syncPlaybackPosition();
}

let initialized = false;

/** Initialize player listeners and the periodic synchronization loop. */
export function initPlaybackClock(): void {
  if (initialized) return;
  initialized = true;

  resetPlaybackClock();
  scheduleNextSync();

  Spicetify.Player.addEventListener("songchange", resetPlaybackClock);
  Spicetify.Player.addEventListener("onplaypause", resetPlaybackClock);
  Spicetify.Player.addEventListener("onprogress", () => {
    const rawPosition = (Spicetify.Player.getProgress?.() ?? 0) / 1000;
    if (!Number.isFinite(rawPosition)) return;
    const now = performance.now();
    const elapsed = Spicetify.Player.isPlaying() ? Math.max(0, (now - syncedAt) / 1000) : 0;
    const extrapolatedPosition = syncedPosition + elapsed;

    if (Math.abs(rawPosition - extrapolatedPosition) <= SEEK_SNAP_THRESHOLD_S) return;

    incrementPerformanceCounter("playbackClock.seekSnaps");
    durationSeconds = readDuration();
    syncedPosition = clampToTrack(rawPosition);
    syncedAt = now;
    predictedPosition = syncedPosition;
    lastPredictTime = now;
    void syncPlaybackPosition();
  });
}

/**
 * Return a smooth playback timestamp in seconds.
 *
 * Passing the already-read playback state avoids querying the player bridge
 * twice from the shared render frame.
 */
export function getSmoothProgress(isPlaying?: boolean): number {
  if (!initialized) initPlaybackClock();

  const playing = isPlaying ?? Spicetify.Player?.isPlaying?.() ?? false;
  const now = performance.now();

  if (!playing) {
    predictedPosition = clampToTrack(syncedPosition);
    lastPredictTime = now;
    return predictedPosition;
  }

  const elapsedSinceSync = Math.max(0, (now - syncedAt) / 1000);
  const measured = clampToTrack(syncedPosition + elapsedSinceSync);
  const dt = Math.max(0, (now - lastPredictTime) / 1000);
  lastPredictTime = now;

  let predicted = clampToTrack(predictedPosition + dt);
  const error = measured - predicted;

  if (Math.abs(error) > SEEK_SNAP_THRESHOLD_S) {
    predicted = measured;
  }

  predictedPosition = clampToTrack(predicted);
  return predictedPosition;
}
