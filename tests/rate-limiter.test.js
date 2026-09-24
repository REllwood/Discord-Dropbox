import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/index.js';
import { createTestStorage } from './helpers/fake-discord.js';

// Timers can fire a millisecond or two late relative to Date.now()
const JITTER_MS = 5;

async function releaseTimes(limiter, count) {
  const start = Date.now();
  const times = [];
  await Promise.all(Array.from({ length: count }, () =>
    limiter.waitIfNeeded().then(() => times.push(Date.now() - start))));
  return times.sort((a, b) => a - b);
}

test('concurrent callers cannot overshoot the limit', async (t) => {
  t.mock.method(console, 'info', () => {});
  const limiter = new RateLimiter(2, 100);

  const times = await releaseTimes(limiter, 6);

  // Any 3 consecutive releases must span at least one full window
  for (let i = 0; i + 2 < times.length; i += 1) {
    assert.ok(
      times[i + 2] - times[i] >= 100 - JITTER_MS,
      `releases ${i} and ${i + 2} were only ${times[i + 2] - times[i]}ms apart: ${times}`,
    );
  }
});

test('requests under the limit are not delayed', async () => {
  const limiter = new RateLimiter(5, 1000);

  const times = await releaseTimes(limiter, 5);

  assert.ok(times[4] < 50, `expected no waiting, got ${times}`);
});

test('reset() clears the window', async (t) => {
  t.mock.method(console, 'info', () => {});
  const limiter = new RateLimiter(1, 10_000);
  await limiter.waitIfNeeded();

  limiter.reset();
  const start = Date.now();
  await limiter.waitIfNeeded();

  assert.ok(Date.now() - start < 50);
});

test('the constructor rejects invalid settings', () => {
  assert.throws(() => new RateLimiter(0, 1000), RangeError);
  assert.throws(() => new RateLimiter(1.5, 1000), RangeError);
  assert.throws(() => new RateLimiter(5, 0), RangeError);
  assert.throws(() => new RateLimiter(5, NaN), RangeError);
});

test('the rateLimit option throttles storage operations', async (t) => {
  const { storage, channel } = createTestStorage(t, {
    config: { rateLimit: { maxRequests: 1, windowMs: 60 } },
  });
  const sendTimes = [];
  const send = channel.send.bind(channel);
  t.mock.method(channel, 'send', (options) => {
    sendTimes.push(Date.now());
    return send(options);
  });

  await Promise.all([1, 2, 3].map((i) =>
    storage.upload(Buffer.from('x'), { filename: `${i}.txt` })));

  assert.equal(sendTimes.length, 3);
  for (let i = 1; i < sendTimes.length; i += 1) {
    assert.ok(
      sendTimes[i] - sendTimes[i - 1] >= 60 - JITTER_MS,
      `sends ${i - 1} and ${i} were only ${sendTimes[i] - sendTimes[i - 1]}ms apart`,
    );
  }
});

test('a RateLimiter instance can be shared between storages', async (t) => {
  const shared = new RateLimiter(3, 1000);
  const first = createTestStorage(t, { config: { rateLimit: shared } });
  const second = createTestStorage(t, { config: { rateLimit: shared } });

  assert.equal(first.storage.rateLimiter, shared);
  assert.equal(second.storage.rateLimiter, shared);
});

test('no rate limiter is used by default', async (t) => {
  const { storage } = createTestStorage(t);

  assert.equal(storage.rateLimiter, null);
});
