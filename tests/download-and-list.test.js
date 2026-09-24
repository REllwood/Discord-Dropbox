import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordStorage } from '../src/index.js';
import { createTestStorage, mockCdn } from './helpers/fake-discord.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'discord-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function sendFile(channel, name, content = name) {
  return channel.send({ content: `Uploaded: ${name}`, files: [{ attachment: Buffer.from(content), name }] });
}

test('download() saves the attachment to disk', async (t) => {
  const { storage, channel } = createTestStorage(t);
  mockCdn(t, channel);
  const dir = await tempDir(t);
  const upload = await storage.upload(Buffer.from('file contents'), { filename: 'notes.txt' });
  const outputPath = join(dir, 'notes.txt');

  const result = await storage.download(upload.messageId, outputPath);

  assert.equal(result.success, true);
  assert.equal(result.filename, 'notes.txt');
  assert.equal(result.savedTo, outputPath);
  assert.equal(await readFile(outputPath, 'utf8'), 'file contents');
  assert.deepEqual(await readdir(dir), ['notes.txt']);
});

test('download() reports HTTP errors and writes nothing', async (t) => {
  const { storage } = createTestStorage(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('gone', { status: 404 }));
  const dir = await tempDir(t);
  const upload = await storage.upload(Buffer.from('x'), { filename: 'x.txt' });

  await assert.rejects(
    storage.download(upload.messageId, join(dir, 'x.txt')),
    /Download failed: Failed to download: HTTP 404/,
  );
  assert.deepEqual(await readdir(dir), []);
});

test('download() removes the partial file when the transfer breaks', async (t) => {
  const { storage } = createTestStorage(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new Error('connection reset'));
    },
  })));
  const dir = await tempDir(t);
  const upload = await storage.upload(Buffer.from('x'), { filename: 'x.txt' });

  await assert.rejects(storage.download(upload.messageId, join(dir, 'x.txt')), /connection reset/);
  assert.deepEqual(await readdir(dir), []);
});

test('download() gives up after downloadTimeoutMs', async (t) => {
  const { storage } = createTestStorage(t, { config: { downloadTimeoutMs: 20 } });
  t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  // AbortSignal.timeout() doesn't keep the process alive; a real socket would
  const keepAlive = setTimeout(() => {}, 5_000);
  t.after(() => clearTimeout(keepAlive));
  const dir = await tempDir(t);
  const upload = await storage.upload(Buffer.from('x'), { filename: 'x.txt' });

  await assert.rejects(storage.download(upload.messageId, join(dir, 'x.txt')), /timeout/i);
});

test('downloadTimeoutMs must be a positive number', () => {
  for (const bad of [0, -5, NaN, '1000']) {
    assert.throws(
      () => new DiscordStorage({ token: 't', channelId: 'c', downloadTimeoutMs: bad }),
      RangeError,
    );
  }
});

test('download() validates the output path before connecting', async (t) => {
  const { storage, clients } = createTestStorage(t);

  await assert.rejects(storage.download('123', ''), TypeError);
  await assert.rejects(storage.download('123'), TypeError);
  assert.equal(clients.length, 0);
});

test('listUploads() counts uploads, not messages', async (t) => {
  const { storage, channel } = createTestStorage(t);
  await sendFile(channel, 'a.txt');
  await sendFile(channel, 'b.txt');
  channel.addMessage({ author: channel.botUser, content: 'text only' });
  channel.addMessage({ author: channel.botUser, content: 'text only' });

  const uploads = await storage.listUploads(2);

  assert.deepEqual(uploads.map((u) => u.filename), ['b.txt', 'a.txt']);
});

test('listUploads() skips files posted by other users', async (t) => {
  const { storage, channel } = createTestStorage(t);
  await sendFile(channel, 'mine.txt');
  const theirs = await sendFile(channel, 'theirs.txt');
  theirs.author = { id: 'someone-else' };

  const uploads = await storage.listUploads();

  assert.deepEqual(uploads.map((u) => u.filename), ['mine.txt']);
});

test('listUploads() pages back past 100 messages, newest first', async (t) => {
  const { storage, channel } = createTestStorage(t);
  for (let i = 0; i < 150; i += 1) {
    await sendFile(channel, `file-${i}.txt`);
  }

  const uploads = await storage.listUploads(120);

  assert.equal(uploads.length, 120);
  assert.equal(uploads[0].filename, 'file-149.txt');
  assert.equal(uploads[119].filename, 'file-30.txt');
  assert.equal(new Set(uploads.map((u) => u.messageId)).size, 120);
});

test('listUploads() stops when the history runs out', async (t) => {
  const { storage, channel } = createTestStorage(t);
  await sendFile(channel, 'only.txt');

  const uploads = await storage.listUploads(50);

  assert.equal(uploads.length, 1);
});

test('listUploads() rejects an invalid limit', async (t) => {
  const { storage } = createTestStorage(t);

  for (const bad of [0, -1, 1.5, '10', Infinity]) {
    await assert.rejects(storage.listUploads(bad), RangeError);
  }
});
