export type RetryOptions = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastErr: unknown;

  for (let i = 0; i < options.attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** i);
      if (i < options.attempts - 1) {
        await sleep(delay);
      }
    }
  }

  throw lastErr;
}
