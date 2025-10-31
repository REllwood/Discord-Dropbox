/**
 * Simple rate limiter to prevent hitting Discord's API limits
 */
export class RateLimiter {
  constructor(maxRequests = 5, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  /**
   * Wait if necessary to respect rate limits
   * @returns {Promise<void>}
   */
  async waitIfNeeded() {
    const now = Date.now();
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached. Waiting ${waitTime}ms...`);
        await this._sleep(waitTime);
      }
      
      const newNow = Date.now();
      this.requests = this.requests.filter(
        timestamp => newNow - timestamp < this.windowMs
      );
    }
    this.requests.push(Date.now());
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

