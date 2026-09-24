/**
 * Anything with info() and error() methods, such as console or most logging libraries
 */
export interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Simple sliding-window rate limiter.
 * discord.js already respects Discord's own rate limits; use this when you
 * want to stay well below them.
 */
export class RateLimiter {
  /**
   * @param maxRequests - Requests allowed per window (default: 5)
   * @param windowMs - Window length in milliseconds (default: 1000)
   * @param options.logger - Where to report waits (default: console), or null for silence
   */
  constructor(maxRequests?: number, windowMs?: number, options?: { logger?: Logger | null });

  readonly maxRequests: number;
  readonly windowMs: number;

  /**
   * Wait if necessary to respect rate limits. Concurrent callers are served
   * one at a time, in order.
   */
  waitIfNeeded(): Promise<void>;

  /**
   * Reset the rate limiter
   */
  reset(): void;
}

export default RateLimiter;
