import { setTimeout as delay } from "node:timers/promises";

export class OracleError extends Error {
  constructor(
    public readonly code: "http" | "network" | "invalid_response" | "pool_read",
    public readonly retryable = false,
    public readonly retryAfterMs = 0,
  ) {
    super(`Price oracle error: ${code}`);
  }
}

export async function retry<T>(
  action: () => Promise<T>,
  options: {
    attempts?: number;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= attempts - 1 || !(error instanceof OracleError) || !error.retryable)
        throw error;
      const wait = Math.min(30_000, Math.max(500 * 2 ** attempt, error.retryAfterMs));
      await (options.sleep ?? delay)(wait);
    }
  }
}
