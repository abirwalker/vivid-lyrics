import { openModal } from "./settings-modal";

const SettingsIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4,12H0v2h4v1h3v-4H4V12zM9,10h3V6H9v1H0v2h9V10zM3,5h3V1H3v1H0v2h3V5zM8,14h8v-2H8V14zM7,2v2h9V2H7zM13,9h3V7h-3V9z"/></svg>`;

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
