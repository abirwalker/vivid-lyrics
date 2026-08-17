import { setupCardView } from "./components/views/card-view";
import { setupFullscreen } from "./components/views/fullscreen-view";
import { setupMainPage } from "./components/views/main-view";
import { setupPlaybarButton } from "./components/playbar-button";
import { setupSettings, applyStoredFont } from "./components/settings-modal";
import { setupProfileMenu } from "./components/profile-menu";
import { setupDevBadge } from "./tools/dev-badge";
import { setupDynamicColors } from "./utils/palette-extractor";

const VividLyrics = { version: "0.2.0" };

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

  setupDynamicColors();
  setupCardView();
  setupFullscreen();
  setupMainPage();
  setupPlaybarButton();
  setupSettings();
  applyStoredFont();
  setupProfileMenu();
  setupDevBadge();
}

main();
