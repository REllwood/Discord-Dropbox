/**
 * Simple sliding-window rate limiter.
 * discord.js already respects Discord's own rate limits; use this when you
 * want to stay well below them.
 */
export class RateLimiter {
  /**
   * @param maxRequests - Requests allowed per window (default: 5)
   * @param windowMs - Window length in milliseconds (default: 1000)
   */
  constructor(maxRequests?: number, windowMs?: number);

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
