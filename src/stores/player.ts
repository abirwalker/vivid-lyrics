export interface PlayerSnapshot {
  uri: string | null;
  title: string;
  artists: string;
  artworkUrl: string | null;
  isPlaying: boolean;
  isShuffled: boolean;
  repeatMode: number;
}

type PlayerListener = (snapshot: PlayerSnapshot) => void;

const listeners = new Set<PlayerListener>();
let initialized = false;
let songGeneration = 0;
let snapshot: PlayerSnapshot = {
  uri: null,
  title: "Nothing playing",
  artists: "Unknown artist",
  artworkUrl: null,
  isPlaying: false,
  isShuffled: false,
  repeatMode: 0,
};

function normalizeArtworkUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("spotify:image:")) {
    return `https://i.scdn.co/image/${url.slice("spotify:image:".length)}`;
  }
  return url;
}

function readSnapshot(): PlayerSnapshot {
  const player = (globalThis as any).Spicetify?.Player;
  const item = player?.data?.item as any;
  const metadata = (item?.metadata ?? {}) as Record<string, string | undefined>;
  const artists = Array.isArray(item?.artists)
    ? item.artists.map((artist: any) => artist?.name).filter(Boolean).join(", ")
    : "";
  const artwork =
    metadata.image_xlarge_url ||
    metadata.image_large_url ||
    metadata.image_url ||
    item?.images?.[0]?.url ||
    item?.album?.images?.[0]?.url ||
    metadata.image_small_url;

  return {
    uri: item?.uri ?? null,
    title: item?.name || metadata.title || "Nothing playing",
    artists:
      artists || item?.artist?.name || metadata.artist_name || metadata.artist || "Unknown artist",
    artworkUrl: normalizeArtworkUrl(artwork),
    isPlaying: player?.isPlaying?.() ?? false,
    isShuffled: Boolean(player?.origin?._state?.shuffle || player?.origin?._state?.smartShuffle),
    repeatMode: Number(player?.getRepeat?.() ?? player?.origin?._state?.repeat ?? 0),
  };
}

function isEqual(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
  return (
    a.uri === b.uri &&
    a.title === b.title &&
    a.artists === b.artists &&
    a.artworkUrl === b.artworkUrl &&
    a.isPlaying === b.isPlaying &&
    a.isShuffled === b.isShuffled &&
    a.repeatMode === b.repeatMode
  );
}

function publish(): void {
  const next = readSnapshot();
  if (isEqual(snapshot, next)) return;
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

function onSongChange(): void {
  const generation = ++songGeneration;
  publish();
  // Spotify sometimes publishes complete image metadata just after songchange.
  for (const delay of [100, 300, 700]) {
    setTimeout(() => {
      if (generation === songGeneration) publish();
    }, delay);
  }
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  snapshot = readSnapshot();
  Spicetify.Player.addEventListener("songchange", onSongChange);
  Spicetify.Player.addEventListener("onplaypause", publish);
  Spicetify.Player.origin?._events?.addListener?.("update", publish);
}

export function onPlayerChange(listener: PlayerListener): () => void {
  initialize();
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}
