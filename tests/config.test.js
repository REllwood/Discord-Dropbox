import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { Events } from 'discord.js';
import { DiscordStorage, RateLimiter } from '../src/index.js';
import { createTestStorage } from './helpers/fake-discord.js';

function recordingLogger() {
  const lines = [];
  return {
    lines,
    info: (...args) => lines.push(['info', ...args]),
    error: (...args) => lines.push(['error', ...args]),
  };
}

test('the token is usable but hidden from inspection and JSON', () => {
  const storage = new DiscordStorage({ token: 'super-secret-token', channelId: '1' });

  assert.equal(storage.token, 'super-secret-token');
  assert.ok(!Object.keys(storage).includes('token'));
  assert.ok(!inspect(storage).includes('super-secret-token'));
  assert.ok(!JSON.stringify(storage).includes('super-secret-token'));
});

test('a missing config object gives the usual friendly error', () => {
  assert.throws(() => new DiscordStorage(), /token is required/);
});

test('status messages go to the configured logger', async (t) => {
  const logger = recordingLogger();
  const { storage, clients } = createTestStorage(t, { config: { logger } });

  await storage.connect();
  clients[0].emit(Events.Error, new Error('boom'));
  await storage.disconnect();

  assert.deepEqual(logger.lines.map(([level, message]) => [level, message]), [
    ['info', '✅ Connected as StorageBot#0001'],
    ['error', '❌ Discord client error:'],
    ['info', '✅ Disconnected from Discord'],
  ]);
});

test('logger: null keeps the library silent', async (t) => {
  const { storage, clients } = createTestStorage(t, { config: { logger: null } });

  await storage.connect();
  clients[0].emit(Events.Error, new Error('boom'));
  await storage.disconnect();

  assert.equal(console.info.mock.callCount(), 0);
  assert.equal(console.error.mock.callCount(), 0);
});

test('the console is used by default', async (t) => {
  const { storage } = createTestStorage(t);

  await storage.connect();

  assert.equal(console.info.mock.callCount(), 1);
});

test('the rate limiter reports waits through the storage logger', async (t) => {
  const logger = recordingLogger();
  const { storage } = createTestStorage(t, {
    config: { logger, rateLimit: { maxRequests: 1, windowMs: 20 } },
  });

  await storage.upload(Buffer.from('a'), { filename: 'a.txt' });
  await storage.upload(Buffer.from('b'), { filename: 'b.txt' });

  assert.ok(logger.lines.some(([, message]) => message.startsWith('⏳ Rate limit reached')));
});

test('RateLimiter accepts logger: null', async () => {
  const limiter = new RateLimiter(1, 20, { logger: null });

  await limiter.waitIfNeeded();
  await limiter.waitIfNeeded();

  assert.equal(limiter.logger, null);
});
