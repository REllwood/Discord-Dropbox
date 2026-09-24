/**
 * Basic usage: upload a file, get a fresh URL for it, download it, then delete it.
 *
 * Run with: npm run example
 * Needs DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env (copy .env.example).
 */
import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { DiscordStorage } from '../src/index.js';

const { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env first (copy .env.example).');
  process.exit(1);
}

// A 1x1 PNG, so the example doesn't need any image files on disk
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOISP30HwAFdwKvhpvLXgAAAABJRU5ErkJggg==',
  'base64',
);

const storage = new DiscordStorage({
  token: DISCORD_BOT_TOKEN,
  channelId: DISCORD_CHANNEL_ID,
});

try {
  const upload = await storage.upload(PIXEL_PNG, {
    filename: 'pixel.png',
    description: 'Example upload from basic-usage.js',
  });
  console.log(`Uploaded ${upload.filename} (${upload.size} bytes) as message ${upload.messageId}`);

  // Attachment URLs expire after a while, so keep the message ID and ask for
  // a fresh URL whenever you need one
  const info = await storage.getImageUrl(upload.messageId);
  console.log('Current URL:', info.url);

  await mkdir('downloaded-images', { recursive: true });
  const download = await storage.download(upload.messageId, 'downloaded-images/pixel.png');
  console.log('Downloaded to', download.savedTo);

  await storage.delete(upload.messageId);
  console.log('Deleted message', upload.messageId);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await storage.disconnect();
}
