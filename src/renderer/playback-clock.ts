let syncedPosition = 0; // seconds
let syncedAt = 0; // performance.now() ms
let predictedPosition = 0; // seconds
let lastPredictTime = 0; // performance.now() ms
let lastTrackUri: string | null = null;
let durationSeconds = 0;
let syncRevision = 0;
let latestSyncRequest = 0;
let syncTimeoutId: ReturnType<typeof setTimeout> | null = null;

const SEEK_SNAP_THRESHOLD_S = 0.5;
// performance.now() is stable between player events, so a slow health-check is
// enough. Keeping this at 1 Hz avoids injecting four IPC completions per second
// into Spotify's already busy homepage render workload.
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

/** Sample Spotify's position, compensating approximately for request latency. */
export async function syncPlaybackPosition(): Promise<void> {
  const player = Spicetify.Player;
  const platform = Spicetify.Platform;
  if (!player || !platform) return;

  const currentUri = getTrackUri();
  if (currentUri !== lastTrackUri) {
    syncRevision++;
    seedFromPlayer();
  }

  const requestRevision = syncRevision;
  const requestId = ++latestSyncRequest;
  const requestUri = currentUri;
  const requestStartedAt = performance.now();
  let sampledPosition: number;
  let sampledAt: number;

  try {
    const contextPlayer = (platform as any).PlayerAPI?._contextPlayer;
    if (contextPlayer?.getPositionState) {
      const { position } = await contextPlayer.getPositionState({});
      const requestFinishedAt = performance.now();
      sampledAt = (requestStartedAt + requestFinishedAt) / 2;
      sampledPosition = Number(position) / 1000;
    } else {
      sampledAt = performance.now();
      sampledPosition = (player.getProgress?.() ?? 0) / 1000;
    }
  } catch {
    sampledAt = performance.now();
    sampledPosition = (player.getProgress?.() ?? 0) / 1000;
  }

  // A seek, pause/resume, or song change may have happened while the IPC
  // request was in flight. Never let that stale response rewind the clock.
  if (
    requestId !== latestSyncRequest ||
    requestRevision !== syncRevision ||
    requestUri !== getTrackUri()
  )
    return;
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
  syncRevision++;
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
    const now = performance.now();
    const elapsed = Spicetify.Player.isPlaying() ? Math.max(0, (now - syncedAt) / 1000) : 0;
    const extrapolatedPosition = syncedPosition + elapsed;

    if (Math.abs(rawPosition - extrapolatedPosition) <= SEEK_SNAP_THRESHOLD_S) return;

    syncRevision++;
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
