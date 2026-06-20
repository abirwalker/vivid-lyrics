import { setupCardView } from "./components/card-view";
import { setupFullscreen } from "./components/fullscreen-view";
import { setupMainPage } from "./components/main-view";
import { setupPlaybarButton } from "./components/playbar-button";
import { setupSettings } from "./components/settings-modal";
import { setupProfileMenu } from "./components/profile-menu";

const VividLyrics = { version: "0.1.0" };

async function waitForSpicetify(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (Spicetify?.Player && Spicetify?.Platform && Spicetify?.CosmosAsync) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

async function main() {
  await waitForSpicetify();

  (window as any).__vivid_lyrics = VividLyrics;
  console.log("[Vivid Lyrics] Loaded v" + VividLyrics.version);

  setupCardView();
  setupFullscreen();
  setupMainPage();
  setupPlaybarButton();
  setupSettings();
  setupProfileMenu();
}

main();
