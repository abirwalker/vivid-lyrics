import { setPageMode, getPageMode } from "../stores/page";

const EXTRA_CONTROLS_SEL = ".main-nowPlayingBar-extraControls";
const CinemaIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v10H1V3zm1 1v8h12V4H2zm2 2h2v4H4V6zm4 0h2v4H8V6z"/></svg>`;
const FullscreenIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.53 9.47a.75.75 0 0 1 0 1.06l-2.72 2.72h1.94a.75.75 0 0 1 0 1.5H1.75v-4a.75.75 0 0 1 1.5 0v1.94l2.72-2.72a.75.75 0 0 1 1.06 0zm2.94-2.94a.75.75 0 0 1 0-1.06l2.72-2.72h-1.94a.75.75 0 1 1 0-1.5h4v4a.75.75 0 0 1-1.5 0V3.31l-2.72 2.72a.75.75 0 0 1-1.06 0z"/></svg>`;

let injected = false;

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

  container.appendChild(makeBtn(CinemaIcon, "Vivid Cinema", () => {
    const mode = getPageMode();
    setPageMode(mode === "page" ? "cinema" : "page");
  }));

  container.appendChild(makeBtn(FullscreenIcon, "Vivid Fullscreen", () => {
    (Spicetify.Platform.History as any).push({ pathname: "/vivid-lyrics" });
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
