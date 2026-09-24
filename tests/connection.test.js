import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { DiscordStorage } from '../src/index.js';
import { FakeChannel, FakeClient } from './helpers/fake-discord.js';

/**
 * Create a storage instance whose clients are fakes sharing one channel.
 * `clientOptions` may be a function of the attempt number (0, 1, ...).
 */
function setup(t, clientOptions = {}) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const channel = new FakeChannel('channel-1');
  const clients = [];
  const storage = new DiscordStorage({ token: 'token', channelId: 'channel-1' });
  storage._createClient = () => {
    const options = typeof clientOptions === 'function'
      ? clientOptions(clients.length)
      : clientOptions;
    const client = new FakeClient({ channels: [channel], ...options });
    clients.push(client);
    return client;
  };

  return { storage, channel, clients };
}

test('constructor requires a token and channel ID', () => {
  assert.throws(() => new DiscordStorage({ channelId: 'c' }), /token is required/);
  assert.throws(() => new DiscordStorage({ token: 't' }), /channel ID is required/);
});

test('the default client is a discord.js Client with the required intents', async () => {
  const storage = new DiscordStorage({ token: 'token', channelId: 'channel-1' });
  const client = storage._createClient();

  try {
    assert.ok(client instanceof Client);
    assert.ok(client.options.intents.has(GatewayIntentBits.Guilds));
    assert.ok(client.options.intents.has(GatewayIntentBits.GuildMessages));
  } finally {
    await client.destroy();
  }
});

test('connect() waits for clientReady', async (t) => {
  const { storage, clients } = setup(t, { readyDelay: 10 });

  await storage.connect();

  assert.equal(storage.isReady, true);
  assert.equal(clients[0].user.tag, 'StorageBot#0001');
});

test('concurrent connect() calls share a single login', async (t) => {
  const { storage, clients } = setup(t);

  await Promise.all([storage.connect(), storage.connect(), storage.connect()]);

  assert.equal(clients.length, 1);
  assert.equal(clients[0].loginCalls, 1);
});

test('a failed login is not cached, so connect() can retry', async (t) => {
  const { storage, clients } = setup(t, (attempt) => ({
    loginError: attempt === 0 ? new Error('An invalid token was provided.') : null,
  }));

  await assert.rejects(storage.connect(), /invalid token/);
  assert.equal(storage.client, null);
  assert.equal(clients[0].destroyed, true);

  await storage.connect();
  assert.equal(storage.isReady, true);
  assert.equal(clients.length, 2);
});

test('the instance can reconnect and upload after disconnect()', async (t) => {
  const { storage, clients } = setup(t);

  await storage.connect();
  await storage.disconnect();
  assert.equal(clients[0].destroyed, true);
  assert.equal(storage.isReady, false);

  const result = await storage.upload(Buffer.from('hello'), { filename: 'hello.txt' });

  assert.equal(result.success, true);
  assert.equal(clients.length, 2);
  assert.equal(storage.isReady, true);
});

test('disconnect() while connecting rejects the pending connect()', async (t) => {
  const { storage, clients } = setup(t, { readyDelay: 50 });

  const pending = storage.connect();
  await storage.disconnect();

  await assert.rejects(pending, /Disconnected before the connection was ready/);
  assert.equal(clients[0].destroyed, true);
  assert.equal(storage.client, null);

  await storage.connect();
  assert.equal(storage.isReady, true);
});

test('client errors after login are logged instead of crashing', async (t) => {
  const { storage, clients } = setup(t);
  await storage.connect();

  assert.doesNotThrow(() => {
    clients[0].emit(Events.Error, new Error('first'));
    clients[0].emit(Events.Error, new Error('second'));
  });
  assert.equal(console.error.mock.callCount(), 2);
});

test('disconnect() without a connection is a no-op', async (t) => {
  const { storage, clients } = setup(t);

  await storage.disconnect();

  assert.equal(clients.length, 0);
});
