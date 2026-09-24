/**
 * Advanced usage: rate-limited batch uploads, a gallery index keyed by
 * message ID, refreshing URLs, listing, error details and clean-up.
 *
 * Run with: npm run advanced
 * Needs DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env (copy .env.example).
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { DiscordStorage } from '../src/index.js';

const { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env first (copy .env.example).');
  process.exit(1);
}

const storage = new DiscordStorage({
  token: DISCORD_BOT_TOKEN,
  channelId: DISCORD_CHANNEL_ID,
  // Stay well under Discord's own limits: at most 2 API requests per second
  rateLimit: { maxRequests: 2, windowMs: 1000 },
  // Give up on downloads that take longer than 30 seconds
  downloadTimeoutMs: 30_000,
  // Anything with info() and error() works here (pino, winston, ...); null silences the library
  logger: {
    info: (message) => console.log(`[storage] ${message}`),
    error: (...args) => console.error('[storage]', ...args),
  },
});

const uploads = [];

try {
  // 1. Upload several files at once; the rate limiter spaces the requests out
  const files = ['red', 'green', 'blue'].map((colour) => ({
    filename: `${colour}.txt`,
    data: Buffer.from(`A small file about the colour ${colour}\n`),
  }));
  for (const upload of await Promise.all(files.map(({ filename, data }) =>
    storage.upload(data, { filename, description: `Colour sample: ${filename}` })))) {
    uploads.push(upload);
    console.log(`Uploaded ${upload.filename} as message ${upload.messageId}`);
  }

  // 2. Save a gallery index. Store message IDs rather than URLs, because
  //    Discord attachment URLs expire
  const gallery = uploads.map(({ messageId, filename, size, uploadedAt }) => ({
    messageId,
    filename,
    size,
    uploadedAt,
  }));
  await writeFile('gallery.json', JSON.stringify(gallery, null, 2));
  console.log('Wrote gallery.json');

  // 3. Later on, turn the index back into fresh URLs
  for (const entry of gallery) {
    const { url } = await storage.getImageUrl(entry.messageId);
    console.log(`${entry.filename}: ${url}`);
  }

  // 4. List what this bot has stored in the channel (pages past 100 automatically)
  const recent = await storage.listUploads(25);
  console.log(`Found ${recent.length} recent upload(s) from this bot`);

  // 5. Errors keep Discord's original error as `cause`
  try {
    await storage.getImageUrl('1');
  } catch (error) {
    console.log(`Expected failure: ${error.message} (Discord error code ${error.cause?.code})`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // 6. Clean up everything this example uploaded
  for (const { messageId } of uploads) {
    await storage.delete(messageId).catch((error) => console.error(error.message));
  }
  await storage.disconnect();
}
