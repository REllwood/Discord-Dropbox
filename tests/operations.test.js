import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiError, createTestStorage } from './helpers/fake-discord.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'discord-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('upload() from a Buffer returns the attachment details', async (t) => {
  const { storage, channel } = createTestStorage(t);

  const result = await storage.upload(Buffer.from('hello'), {
    filename: 'hello.txt',
    description: 'A greeting',
  });

  assert.equal(result.success, true);
  assert.equal(result.filename, 'hello.txt');
  assert.equal(result.size, 5);
  assert.equal(result.description, 'A greeting');
  assert.match(result.url, /^https:\/\/cdn\.discordapp\.com\//);
  assert.ok(channel.store.has(result.messageId));
});

test('upload() from a path uses the file name and a default description', async (t) => {
  const { storage } = createTestStorage(t);
  const dir = await tempDir(t);
  const path = join(dir, 'photo.png');
  await writeFile(path, Buffer.alloc(42));

  const result = await storage.upload(path);

  assert.equal(result.filename, 'photo.png');
  assert.equal(result.size, 42);
  assert.equal(result.description, 'Uploaded: photo.png');
});

test('upload() never lets the description ping anyone', async (t) => {
  const { storage, channel } = createTestStorage(t);

  await storage.upload(Buffer.from('x'), { filename: 'x.txt', description: '@everyone look' });

  assert.deepEqual(channel.sent[0].allowedMentions, { parse: [] });
});

test('upload() validates its arguments before connecting', async (t) => {
  const { storage, clients } = createTestStorage(t);

  await assert.rejects(storage.upload(Buffer.from('x')), /Filename is required/);
  await assert.rejects(storage.upload(42), TypeError);
  await assert.rejects(storage.upload(''), TypeError);
  await assert.rejects(
    storage.upload(Buffer.from('x'), { filename: 'x.txt', description: 'a'.repeat(2001) }),
    /2000 characters or fewer/,
  );
  await assert.rejects(storage.upload('/no/such/file.png'), /Upload failed: ENOENT/);

  assert.equal(clients.length, 0);
});

test('upload() explains when a file is over the server upload limit', async (t) => {
  const { storage, channel } = createTestStorage(t);
  t.mock.method(channel, 'send', async () => {
    throw apiError(40005, 'Request entity too large', 413);
  });

  await assert.rejects(
    storage.upload(Buffer.from('x'), { filename: 'big.bin' }),
    (error) => {
      assert.match(error.message, /larger than this server's upload limit/);
      assert.equal(error.cause.code, 40005);
      return true;
    },
  );
});

test('upload() also explains a bare HTTP 413 that has no Discord error code', async (t) => {
  const { storage, channel } = createTestStorage(t);
  t.mock.method(channel, 'send', async () => {
    throw apiError(undefined, 'Request Entity Too Large', 413);
  });

  await assert.rejects(
    storage.upload(Buffer.from('x'), { filename: 'big.bin' }),
    /larger than this server's upload limit/,
  );
});

test('an unknown channel gives a clear error that keeps the original cause', async (t) => {
  const { storage } = createTestStorage(t, { config: { channelId: '999' } });

  await assert.rejects(
    storage.upload(Buffer.from('x'), { filename: 'x.txt' }),
    (error) => {
      assert.match(error.message, /^Upload failed: Channel 999 not found or not accessible/);
      assert.equal(error.cause.code, 10003);
      return true;
    },
  );
});

test('a channel that is not text-based is rejected', async (t) => {
  const category = { id: 'channel-1', isTextBased: () => false };
  const { storage } = createTestStorage(t, { channels: [category] });

  await assert.rejects(storage.listUploads(), /is not a text channel/);
});

test('getImageUrl() returns the current details of an upload', async (t) => {
  const { storage } = createTestStorage(t);
  const upload = await storage.upload(Buffer.from('abc'), { filename: 'a.txt', description: 'desc' });

  const info = await storage.getImageUrl(upload.messageId);

  assert.equal(info.url, upload.url);
  assert.equal(info.filename, 'a.txt');
  assert.equal(info.size, 3);
  assert.equal(info.description, 'desc');
});

test('getImageUrl() returns a freshly signed URL once the upload URL has expired', async (t) => {
  const { storage, channel } = createTestStorage(t);
  const upload = await storage.upload(Buffer.from('abc'), { filename: 'a.txt' });

  channel.expireUrls();
  const info = await storage.getImageUrl(upload.messageId);

  assert.notEqual(info.url, upload.url);
  assert.deepEqual(channel.cdnLookup(info.url), Buffer.from('abc'));
});

test('getImageUrl() rejects messages without attachments', async (t) => {
  const { storage, channel } = createTestStorage(t);
  const message = channel.addMessage({ author: channel.botUser, content: 'just text' });

  await assert.rejects(storage.getImageUrl(message.id), /No attachments found/);
});

test('delete() removes the message', async (t) => {
  const { storage, channel } = createTestStorage(t);
  const upload = await storage.upload(Buffer.from('abc'), { filename: 'a.txt' });

  // As if the file had been uploaded by an earlier run
  channel.messages.cache.clear();
  channel.requests.length = 0;

  const result = await storage.delete(upload.messageId);

  assert.equal(result.success, true);
  assert.equal(channel.store.has(upload.messageId), false);
  assert.deepEqual(channel.requests, [`DELETE message ${upload.messageId}`]);
  await assert.rejects(storage.delete(upload.messageId), /Delete failed: Unknown Message/);
});

test('a deleted upload is not served from the discord.js cache', async (t) => {
  const { storage } = createTestStorage(t);
  const upload = await storage.upload(Buffer.from('abc'), { filename: 'a.txt' });

  await storage.delete(upload.messageId);

  await assert.rejects(storage.getImageUrl(upload.messageId), /Unknown Message/);
  await assert.rejects(storage.download(upload.messageId, 'out.txt'), /Unknown Message/);
});

test('message IDs are validated so delete(undefined) cannot report success', async (t) => {
  const { storage, clients } = createTestStorage(t);

  for (const bad of [undefined, '', 123, 'abc']) {
    await assert.rejects(storage.delete(bad), TypeError);
    await assert.rejects(storage.getImageUrl(bad), TypeError);
    await assert.rejects(storage.download(bad, 'out.bin'), TypeError);
  }

  assert.equal(clients.length, 0);
});
