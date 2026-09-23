export type RequestFailureKind = "aborted" | "timeout" | "network";

export class RequestFailure extends Error {
  public readonly kind: RequestFailureKind;

  constructor(
    kind: RequestFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RequestFailure";
    this.kind = kind;
  }
}

type FetchDeadlineOptions = RequestInit & {
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

export async function fetchWithDeadline(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init }: FetchDeadlineOptions = {},
): Promise<Response> {
  if (signal?.aborted) throw new RequestFailure("aborted", "Request aborted");

  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) {
      throw new RequestFailure("aborted", "Request aborted", { cause: error });
    }
    if (timedOut) {
      throw new RequestFailure("timeout", `Request exceeded ${timeoutMs}ms`, { cause: error });
    }
    throw new RequestFailure("network", "Network request failed", { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RequestFailure("aborted", "Request aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestFailure("aborted", "Request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
