/**
 * Backoff helper for rate limiting.
 */

export interface BackoffState {
  attempt: number;
  nextDelay: number;
}

export function computeBackoff(attempt: number, baseMs = 1000, maxMs = 60000): number {
  const delay = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  return delay + Math.random() * delay * 0.3; // jitter
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new Error("Aborted"));
        return;
      }
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }, { once: true });
    }
  });
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const { maxAttempts = 6, baseMs = 1000, maxMs = 60000, signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt >= maxAttempts - 1) break;
      if (err?.status === 401 || err?.status === 403 || err?.status === 404) throw err;
      const delay = computeBackoff(attempt, baseMs, maxMs);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}