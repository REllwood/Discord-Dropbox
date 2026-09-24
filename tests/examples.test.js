import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordStorage } from '../src/index.js';
import { FakeChannel, FakeClient, mockCdn } from './helpers/fake-discord.js';

/**
 * Run an example script against the in-memory fake Discord, inside a
 * temporary working directory so its output files are cleaned up.
 */
async function runExample(t, name) {
  const dir = await mkdtemp(join(tmpdir(), 'discord-storage-example-'));
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  process.chdir(dir);
  t.after(async () => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    await rm(dir, { recursive: true, force: true });
  });

  for (const method of ['log', 'info', 'error']) {
    t.mock.method(console, method, () => {});
  }
  const channel = new FakeChannel('4242');
  t.mock.method(DiscordStorage.prototype, '_createClient', () => new FakeClient({ channels: [channel] }));
  mockCdn(t, channel);
  process.env.DISCORD_BOT_TOKEN = 'fake-token';
  process.env.DISCORD_CHANNEL_ID = channel.id;

  await import(`../examples/${name}.js`);

  const exitCode = process.exitCode;
  process.exitCode = undefined;
  const errors = console.error.mock.calls.map((call) => call.arguments.join(' '));
  return { dir, channel, exitCode, errors };
}

test('examples/basic-usage.js runs end to end', async (t) => {
  const { dir, channel, exitCode, errors } = await runExample(t, 'basic-usage');

  assert.deepEqual(errors, []);
  assert.equal(exitCode, undefined);
  const png = await readFile(join(dir, 'downloaded-images', 'pixel.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(channel.store.size, 0, 'the example should delete its upload');
});

test('examples/advanced-usage.js runs end to end', async (t) => {
  const { dir, channel, exitCode, errors } = await runExample(t, 'advanced-usage');

  assert.deepEqual(errors, []);
  assert.equal(exitCode, undefined);
  const gallery = JSON.parse(await readFile(join(dir, 'gallery.json'), 'utf8'));
  assert.deepEqual(gallery.map((entry) => entry.filename), ['red.txt', 'green.txt', 'blue.txt']);
  assert.equal(channel.store.size, 0, 'the example should delete its uploads');
});
