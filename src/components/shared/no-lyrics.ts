export const whyamidoingthis = [
  "Just vibe. We'll bring the lyrics back next track.",
  "Congratulations, you get a break from singing!",
  "Words would only ruin the masterpiece.",
  "Humming instructions not included.",
  "You're gonna have to guess this one... if it even has one.",
];

let currentMessage: string | null = null;

export function getNoLyricsMessage(): string {
  if (!currentMessage) {
    currentMessage = whyamidoingthis[Math.floor(Math.random() * whyamidoingthis.length)];
  }
  return currentMessage;
}

export function resetNoLyricsMessage(): void {
  currentMessage = null;
}
