import {
  NextTrackIcon,
  PlayerPauseIcon,
  PlayerPlayIcon,
  PreviousTrackIcon,
  PlayerShuffleIcon,
  PlayerRepeatIcon,
} from "./shared/svg-icons";
import { onPlayerChange, type PlayerSnapshot } from "../stores/player";
import "../styles/player-widget.scss";

export interface PlayerWidget {
  element: HTMLElement;
  destroy(): void;
}

export function createPlayerWidget(variant: "main" | "fullscreen"): PlayerWidget {
  const element = document.createElement("section");
  element.className = `VL-PlayerWidget VL-PlayerWidget-${variant}`;
  element.setAttribute("aria-label", "Now playing");
  element.innerHTML = `
    <div class="VL-PlayerArtworkWrap">
      <div class="VL-PlayerArtworkFallback" aria-hidden="true">♪</div>
      <img class="VL-PlayerArtwork VL-PlayerArtwork-A" alt="" draggable="false" />
      <img class="VL-PlayerArtwork VL-PlayerArtwork-B" alt="" draggable="false" />
    </div>
    <div class="VL-PlayerControls">
      <div class="VL-PlayerControlsSide VL-PlayerControlsSide-left">
        <button class="VL-PlayerButton VL-PlayerAction VL-PlayerShuffle" type="button" aria-label="Enable shuffle" aria-pressed="false"><span class="icon">${PlayerShuffleIcon}</span><span class="btn-text">Shuffle</span></button>
        <button class="VL-PlayerButton VL-PlayerAction VL-PlayerPrevious" type="button" aria-label="Previous track"><span class="icon">${PreviousTrackIcon}</span><span class="btn-text">Previous</span></button>
      </div>
      <button class="VL-PlayerButton VL-PlayerToggle" type="button" aria-label="Play">${PlayerPlayIcon}</button>
      <div class="VL-PlayerControlsSide VL-PlayerControlsSide-right">
        <button class="VL-PlayerButton VL-PlayerAction VL-PlayerNext" type="button" aria-label="Next track"><span class="icon">${NextTrackIcon}</span><span class="btn-text">Next</span></button>
        <button class="VL-PlayerButton VL-PlayerAction VL-PlayerRepeat" type="button" aria-label="Enable repeat" aria-pressed="false"><span class="icon">${PlayerRepeatIcon}<span class="VL-RepeatOne" aria-hidden="true">1</span></span><span class="btn-text">Repeat</span></button>
      </div>
    </div>
    <div class="VL-PlayerMetadata">
      <div class="VL-PlayerTitle"></div>
      <div class="VL-PlayerArtists"></div>
    </div>
  `;

  const artwork = Array.from(element.querySelectorAll<HTMLImageElement>(".VL-PlayerArtwork"));
  const title = element.querySelector<HTMLElement>(".VL-PlayerTitle")!;
  const artists = element.querySelector<HTMLElement>(".VL-PlayerArtists")!;
  const previous = element.querySelector<HTMLButtonElement>(".VL-PlayerPrevious")!;
  const shuffle = element.querySelector<HTMLButtonElement>(".VL-PlayerShuffle")!;
  const toggle = element.querySelector<HTMLButtonElement>(".VL-PlayerToggle")!;
  const next = element.querySelector<HTMLButtonElement>(".VL-PlayerNext")!;
  const repeat = element.querySelector<HTMLButtonElement>(".VL-PlayerRepeat")!;
  const sp = Spicetify as any;
  const toggleTooltip = sp?.Tippy
    ? sp.Tippy(toggle, {
        ...(sp.TippyProps?.default ?? sp.TippyProps),
        content: "Play",
      })
    : null;

  let visibleArtwork = -1;
  let artworkGeneration = 0;
  let lastArtworkUrl: string | null = null;
  let lastPlaying: boolean | null = null;
  let lastShuffled: boolean | null = null;
  let lastRepeatMode: number | null = null;

  function transitionArtwork(url: string | null): void {
    if (url === lastArtworkUrl) return;
    lastArtworkUrl = url;
    const generation = ++artworkGeneration;

    if (!url) {
      for (const image of artwork) image.classList.remove("is-visible");
      visibleArtwork = -1;
      return;
    }

    const preload = new Image();
    preload.onload = () => {
      if (generation !== artworkGeneration) return;
      const nextIndex = visibleArtwork === 0 ? 1 : 0;
      const incoming = artwork[nextIndex];
      const outgoing = visibleArtwork >= 0 ? artwork[visibleArtwork] : null;
      incoming.src = url;
      requestAnimationFrame(() => {
        if (generation !== artworkGeneration) return;
        incoming.classList.add("is-visible");
        outgoing?.classList.remove("is-visible");
        visibleArtwork = nextIndex;
      });
    };
    preload.src = url;
  }

  function update(state: PlayerSnapshot): void {
    if (title.textContent !== state.title) title.textContent = state.title;
    if (artists.textContent !== state.artists) artists.textContent = state.artists;
    transitionArtwork(state.artworkUrl);

    if (state.isPlaying !== lastPlaying) {
      lastPlaying = state.isPlaying;
      toggle.innerHTML = state.isPlaying ? PlayerPauseIcon : PlayerPlayIcon;
      const label = state.isPlaying ? "Pause" : "Play";
      toggle.setAttribute("aria-label", label);
      toggleTooltip?.setContent?.(label);
    }

    if (state.isShuffled !== lastShuffled) {
      lastShuffled = state.isShuffled;
      shuffle.classList.toggle("is-active", state.isShuffled);
      shuffle.setAttribute("aria-pressed", String(state.isShuffled));
      shuffle.setAttribute("aria-label", state.isShuffled ? "Disable shuffle" : "Enable shuffle");
    }

    if (state.repeatMode !== lastRepeatMode) {
      lastRepeatMode = state.repeatMode;
      repeat.classList.toggle("is-active", state.repeatMode > 0);
      repeat.classList.toggle("is-repeat-one", state.repeatMode === 2);
      repeat.setAttribute("aria-pressed", String(state.repeatMode > 0));
      const repeatLabel = state.repeatMode === 0 ? "Enable repeat" : state.repeatMode === 1 ? "Repeat one" : "Disable repeat";
      repeat.setAttribute("aria-label", repeatLabel);
    }
  }

  const onPrevious = () => Spicetify.Player.back?.();
  const onShuffle = () => Spicetify.Player.setShuffle?.(!lastShuffled);
  const onToggle = () => Spicetify.Player.togglePlay?.();
  const onNext = () => Spicetify.Player.next?.();
  const onRepeat = () => Spicetify.Player.setRepeat?.(((lastRepeatMode ?? 0) + 1) % 3);
  shuffle.addEventListener("click", onShuffle);
  previous.addEventListener("click", onPrevious);
  toggle.addEventListener("click", onToggle);
  next.addEventListener("click", onNext);
  repeat.addEventListener("click", onRepeat);
  const unsubscribe = onPlayerChange(update);

  return {
    element,
    destroy(): void {
      artworkGeneration++;
      unsubscribe();
      shuffle.removeEventListener("click", onShuffle);
      previous.removeEventListener("click", onPrevious);
      toggle.removeEventListener("click", onToggle);
      next.removeEventListener("click", onNext);
      repeat.removeEventListener("click", onRepeat);
      toggleTooltip?.destroy?.();
      element.remove();
    },
  };
}
