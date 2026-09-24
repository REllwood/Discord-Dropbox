/**
 * Simple sliding-window rate limiter.
 * discord.js already respects Discord's own rate limits; use this when you
 * want to stay well below them.
 */
export class RateLimiter {
  constructor(maxRequests = 5, windowMs = 1000) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new RangeError('maxRequests must be a positive whole number');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive number');
    }

    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
    this._queue = Promise.resolve();
  }

  /**
   * Wait if necessary to respect rate limits.
   * Callers are served one at a time, in order, so concurrent calls cannot
   * overshoot the limit.
   * @returns {Promise<void>}
   */
  waitIfNeeded() {
    const turn = this._queue.then(() => this._takeSlot());
    // Keep the queue moving even if one caller's turn fails
    this._queue = turn.catch(() => {});
    return turn;
  }

  async _takeSlot() {
    this._prune(Date.now());

    while (this.requests.length >= this.maxRequests) {
      const waitTime = this.windowMs - (Date.now() - this.requests[0]);
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached. Waiting ${waitTime}ms...`);
        await this._sleep(waitTime);
      }
      this._prune(Date.now());
    }

    this.requests.push(Date.now());
  }

  _prune(now) {
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset the rate limiter
   */
  reset() {
    this.requests = [];
  }
}

export default RateLimiter;
