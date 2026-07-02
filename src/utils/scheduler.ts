type TimerType = "timeout" | "interval" | "raf";

// setTimeout/setInterval return `number` under DOM lib typings but `NodeJS.Timeout`
// when Node-flavored globals (e.g. from @types/bun) are also in scope. Accept both
// so this works regardless of which ambient types win in a given build.
type TimerHandle =
  ReturnType<typeof setTimeout> | ReturnType<typeof requestAnimationFrame>;

export type Scheduled = [TimerType, TimerHandle, boolean?];

export function cancel(scheduled: Scheduled): void {
  if (scheduled[2]) return;
  scheduled[2] = true;
  switch (scheduled[0]) {
    case "timeout":
      clearTimeout(scheduled[1]);
      break;
    case "interval":
      clearInterval(scheduled[1]);
      break;
    case "raf":
      cancelAnimationFrame(scheduled[1] as number);
      break;
  }
}

export function timeout(
  seconds: number,
  cb: (...args: any[]) => void,
): Scheduled {
  return ["timeout", setTimeout(cb, seconds * 1000)];
}

export function interval(
  seconds: number,
  cb: (...args: any[]) => void,
): Scheduled {
  return ["interval", setInterval(cb, seconds * 1000)];
}

export function raf(cb: (...args: any[]) => void): Scheduled {
  return ["raf", requestAnimationFrame(cb)];
}

export function defer(cb: (...args: any[]) => void): Scheduled {
  const s: Scheduled = ["raf", 0];
  s[1] = requestAnimationFrame(() => {
    s[0] = "timeout";
    s[1] = setTimeout(cb, 0);
  });
  return s;
}

export function isScheduled(value: unknown): value is Scheduled {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 3 &&
    typeof value[0] === "string" &&
    (typeof value[1] === "number" || typeof value[1] === "object")
  );
}
