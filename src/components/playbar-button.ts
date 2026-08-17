import VividIcon from "./shared/vivid-icon";
import { PlaybarCinemaIcon as FullscreenIcon } from "./shared/svg-icons";
import { setPageMode, getPageMode } from "../stores/page";
import "../styles/playbar.scss";

const EXTRA_CONTROLS_SEL = ".main-nowPlayingBar-extraControls";
const NATIVE_FULLSCREEN_SEL = 'button[data-testid="fullscreen-mode-button"]';
const VIVID_ROUTE = "/vivid-lyrics";

let injected = false;
let vividBtn: HTMLButtonElement | null = null;
let nativeFsObserver: MutationObserver | null = null;

function isVividActive(): boolean {
  const loc = (Spicetify.Platform.History as any).location;
  return loc?.pathname === VIVID_ROUTE;
}

function updateVividActive(): void {
  if (!vividBtn) return;
  vividBtn.classList.toggle("active", isVividActive());
}

function hideNativeFullscreen(): void {
  const btn = document.querySelector<HTMLElement>(NATIVE_FULLSCREEN_SEL);
  if (btn) btn.style.display = "none";
}

function makeBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "VL-PlaybarBtn";
  btn.setAttribute("aria-label", title);
  btn.innerHTML = icon;
  btn.addEventListener("click", onClick);

  const sp = Spicetify as any;
  if (sp?.Tippy) {
    sp.Tippy(btn, {
      ...(sp.TippyProps?.default ?? sp.TippyProps ?? {}),
      content: title,
    });
  }

  return btn;
}

function injectButtons(): void {
  if (injected) return;

  const container = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SEL);
  if (!container) return;

  injected = true;

  vividBtn = makeBtn(VividIcon, "Vivid Lyrics", () => {
    if (isVividActive()) {
      (Spicetify.Platform.History as any).goBack();
    } else {
      (Spicetify.Platform.History as any).push({ pathname: VIVID_ROUTE });
    }
  });

  (Spicetify.Platform.History as any).listen(() => updateVividActive());
  updateVividActive();

  container.prepend(vividBtn);

  container.appendChild(makeBtn(FullscreenIcon, "Vivid Cinema", () => {
    const mode = getPageMode();
    if (mode === "fullscreen" || mode === "cinema") {
      setPageMode("page");
    } else {
      setPageMode("cinema");
    }
  }));

  hideNativeFullscreen();
  nativeFsObserver = new MutationObserver(hideNativeFullscreen);
  nativeFsObserver.observe(container, { childList: true, subtree: true });
}

function observePlaybar(): void {
  const observer = new MutationObserver(() => {
    const container = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SEL);
    if (container && !injected) {
      injectButtons();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

export function setupPlaybarButton(): void {
  observePlaybar();
}
