import VividIcon from "../utils/vivid-icon";
import { setPageMode, getPageMode } from "../stores/page";

const EXTRA_CONTROLS_SEL = ".main-nowPlayingBar-extraControls";
const VIVID_ROUTE = "/vivid-lyrics";
const CinemaIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v10H1V3zm1 1v8h12V4H2zm2 2h2v4H4V6zm4 0h2v4H8V6z"/></svg>`;

let injected = false;
let vividBtn: HTMLButtonElement | null = null;

function isVividActive(): boolean {
  const loc = (Spicetify.Platform.History as any).location;
  return loc?.pathname === VIVID_ROUTE;
}

function updateVividActive(): void {
  if (!vividBtn) return;
  vividBtn.style.color = isVividActive() ? "#1db954" : "";
}

function makeBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.title = title;
  btn.style.cssText = `
    background: none;
    border: none;
    color: var(--text-subdued);
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: color 0.2s;
  `;
  btn.innerHTML = icon;
  btn.addEventListener("mouseenter", () => { btn.style.color = "var(--text-base)"; });
  btn.addEventListener("mouseleave", () => { btn.style.color = "var(--text-subdued)"; });
  btn.addEventListener("click", onClick);
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

  container.appendChild(makeBtn(CinemaIcon, "Vivid Cinema", () => {
    const mode = getPageMode();
    setPageMode(mode === "page" ? "cinema" : "page");
  }));
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
