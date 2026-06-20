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
}

main();
