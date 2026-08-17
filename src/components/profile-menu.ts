import { openModal } from "./settings-modal";
import { SettingsIcon } from "./shared/svg-icons";

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
