import { openModal } from "./settings-modal";

const SettingsIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 8 0Zm3.12 3.07a.75.75 0 0 1 .13 1.05l-1.2 2.15a.75.75 0 0 1-.64.38H6.59a.75.75 0 0 1-.64-.38l-1.2-2.15a.75.75 0 1 1 1.3-.75l.7 1.23h3.4l.7-1.23a.75.75 0 0 1 1.05-.13ZM8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>`;

let registered = false;

async function registerMenuItem(): Promise<void> {
  if (registered) return;

  const waitForMenu = () => new Promise<typeof Spicetify.Menu.Item>((resolve) => {
    const check = () => {
      if (Spicetify?.Menu?.Item) {
        resolve(Spicetify.Menu.Item);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });

  const Item = await waitForMenu();

  const entry = new Item("Vivid Lyrics Settings", false, () => {
    openModal();
  }, SettingsIcon);

  entry.register();
  registered = true;
}

export function setupProfileMenu(): void {
  registerMenuItem();
}
