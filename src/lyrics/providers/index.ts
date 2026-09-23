import { amllProvider } from "./amll.ts";
import { biniProvider } from "./bini.ts";
import { lrclibProvider } from "./lrclib.ts";
import { RequestFailure } from "./request.ts";
import type { Provider, ProviderChainResult, TrackQuery } from "./types.ts";
import { isTimedLyrics } from "./types.ts";

export const DEFAULT_PROVIDERS: Provider[] = [biniProvider, amllProvider, lrclibProvider];

export async function fetchFromProviders(
  query: TrackQuery,
  signal: AbortSignal,
  providers: Provider[] = DEFAULT_PROVIDERS,
): Promise<ProviderChainResult> {
  let staticLyrics: ProviderChainResult["lyrics"] = null;
  let staticProvider: ProviderChainResult["provider"] = null;
  let sawTransientFailure = false;
  let instrumental = false;

  for (const provider of providers) {
    if (signal.aborted) throw new RequestFailure("aborted", "Provider chain aborted");
    const startedAt = performance.now();
    const result = await provider.lookup(query, signal);
    console.info("[VividLyrics] provider lookup", {
      provider: provider.name,
      status: result.status,
      lyricType: result.status === "lyrics" ? result.lyrics.type : undefined,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    if (result.status === "transient") {
      sawTransientFailure = true;
      continue;
    }
    if (result.status === "miss") {
      instrumental ||= result.instrumental === true;
      continue;
    }
    if (isTimedLyrics(result.lyrics)) {
      return {
        lyrics: result.lyrics,
        provider: result.provider,
        definitiveMiss: false,
        instrumental: false,
      };
    }
    if (!staticLyrics) {
      staticLyrics = result.lyrics;
      staticProvider = result.provider;
    }
  }

  if (staticLyrics) {
    return {
      lyrics: staticLyrics,
      provider: staticProvider,
      definitiveMiss: false,
      instrumental: false,
    };
  }
  return {
    lyrics: null,
    provider: null,
    definitiveMiss: !sawTransientFailure,
    instrumental,
  };
}
