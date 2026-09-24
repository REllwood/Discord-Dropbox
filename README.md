# Discord Dropbox (Discord Image Storage)

A Node.js library demonstrating how to use Discord's API for image storage.

## Important Legal Notice

**I am sure this library violates some of Discord's Terms of Service.** Using Discord as a file storage service is explicitly against their ToS and may result in:

- **Account suspension or ban**
- **IP rate limiting**
- **Legal action from Discord**

### Discord Terms of Service (Relevant Sections)

From [Discord's Terms of Service](https://discord.com/terms):

> You may not use the Service for any illegal or unauthorised purpose.

Using Discord's infrastructure as a storage backend for purposes other than communication is considered unauthorised use.

### Acceptable Uses

- **Learning**: Study the code to understand Discord API integration
- **Educational projects**: Use in classroom or tutorial settings with proper disclaimers
- **Local testing**: Run examples locally to understand the concepts

### Unacceptable Uses

- **Production deployments**: Never use this in production applications
- **Public services**: Don't create public-facing services using this library
- **Commercial use**: No commercial applications or paid services
- **High-volume storage**: Don't abuse Discord's infrastructure

---

## Why?

I was curious if this was actually something that could be done and here we are...

---

## Quick Start

### Prerequisites

- Node.js 18.17 or higher (a current LTS release such as 22 or 24 is recommended)
- A Discord account
- A Discord server where you can add a bot

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Open the "Bot" page and click "Reset Token" to get the bot token (keep this secret!)
4. No privileged gateway intents are needed. Message Content Intent only matters if you want to read files that *other* users or bots post in the channel
5. Go to OAuth2 → URL Generator:
   - Select scopes: `bot`
   - Select permissions: `View Channels`, `Send Messages`, `Attach Files`, `Read Message History`
6. Copy the generated URL and open it to add the bot to your server

### 2. Get Your Channel ID

1. Open Discord and enable Developer Mode:
   - User Settings → App Settings → Advanced → Developer Mode
2. Right-click the text channel where you want to store files
3. Click "Copy Channel ID"

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

Copy the template and fill in your token and channel ID:

```bash
cp .env.example .env
```

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
```

### 5. Run the Examples

```bash
# Upload, fetch a URL, download and delete a small image
npm run example

# Rate-limited batch uploads, a gallery index, listing and error handling
npm run advanced
```

Both examples clean up after themselves. Downloads go to `downloaded-images/` and the advanced example writes `gallery.json`; both are git-ignored.

### 6. Run the Tests

```bash
npm test
```

The tests use an in-memory fake of the Discord client, so they need no token and make no network requests. GitHub Actions runs them on Node 18, 20, 22 and 24.

---

## 📖 API Documentation

### Importing

From a clone of this repository:

```javascript
import { DiscordStorage } from './src/index.js';
```

If you install it as a dependency (for example `npm install github:REllwood/Discord-Dropbox`):

```javascript
import { DiscordStorage } from 'discord-image-storage';
```

TypeScript declarations are included.

### Constructor

```javascript
const storage = new DiscordStorage({
  token: process.env.DISCORD_BOT_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID,
});
```

| Option | Default | Description |
|---|---|---|
| `token` | *(required)* | Discord bot token. Kept out of `console.log` and `JSON.stringify` output. |
| `channelId` | *(required)* | ID of the text channel used for storage |
| `downloadTimeoutMs` | `60000` | Abort a download that takes longer than this |
| `rateLimit` | none | Extra throttling on top of discord.js's own rate limit handling: `{ maxRequests, windowMs }`, or a shared `RateLimiter` |
| `logger` | `console` | Where status messages go: any object with `info()` and `error()` (e.g. pino or winston), or `null` for silence |

### How files are stored

Each file is one Discord message with one attachment. **The message ID is the file's permanent handle.** Attachment URLs are signed by Discord and expire after a while (currently around 24 hours), so store message IDs and call `getImageUrl()` when you need a fresh URL.

### Methods

#### `connect()`

Connect to Discord. Every other method calls this for you. Concurrent calls share one login, and if a login fails, calling `connect()` again retries it.

```javascript
await storage.connect();
```

#### `upload(filePathOrBuffer, options)`

Upload a file to Discord.

**Parameters:**
- `filePathOrBuffer` (string|Buffer): Local file path or a Buffer
- `options` (Object):
  - `filename` (string): Custom filename (required if using a Buffer)
  - `description` (string): Optional description, posted as the message text (max 2000 characters). Mentions in it never ping anyone.

**Returns:** Promise<Object>
- `success` (boolean)
- `url` (string): URL of the uploaded file (expires; see above)
- `filename` (string)
- `size` (number): File size in bytes
- `messageId` (string): Discord message ID (needed for download/delete)
- `description` (string)
- `uploadedAt` (Date)

**Example:**

```javascript
// Upload from a file path
const result = await storage.upload('./image.png', {
  description: 'My awesome image'
});

// Upload from a Buffer
const buffer = fs.readFileSync('./image.png');
const result = await storage.upload(buffer, {
  filename: 'image.png',
  description: 'Uploaded from buffer'
});

console.log('Message ID:', result.messageId);
```

#### `download(messageId, outputPath)`

Download a file by message ID. The file is streamed to `<outputPath>.part` and renamed once complete, so a failed download never leaves a partial file behind.

**Parameters:**
- `messageId` (string): Discord message ID containing the file
- `outputPath` (string): Path where to save the downloaded file

**Returns:** Promise<Object>
- `success` (boolean)
- `filename` (string)
- `size` (number)
- `savedTo` (string)
- `downloadedAt` (Date)

**Example:**

```javascript
await storage.download('123456789012345678', './downloaded-image.png');
```

#### `getImageUrl(messageId)`

Get a fresh URL and the metadata for an uploaded file.

**Parameters:**
- `messageId` (string): Discord message ID

**Returns:** Promise<Object>
- `url` (string)
- `filename` (string)
- `size` (number)
- `description` (string)
- `uploadedAt` (Date)

**Example:**

```javascript
const info = await storage.getImageUrl('123456789012345678');
console.log('Current URL:', info.url);
```

#### `listUploads(limit)`

List this bot's most recent uploads in the channel, newest first. It pages back through the channel history until it finds `limit` uploads or reaches the start. Text-only messages and files posted by other users are skipped.

**Parameters:**
- `limit` (number): Maximum number of uploads to return (default: 10)

**Returns:** Promise<Array> of `{ messageId, url, filename, size, description, uploadedAt }`

**Example:**

```javascript
const uploads = await storage.listUploads(20);
uploads.forEach(upload => {
  console.log(`${upload.filename}: ${upload.messageId}`);
});
```

#### `delete(messageId)`

Delete an uploaded file.

**Parameters:**
- `messageId` (string): Discord message ID to delete

**Returns:** Promise<Object>
- `success` (boolean)
- `messageId` (string)
- `deletedAt` (Date)

**Example:**

```javascript
await storage.delete('123456789012345678');
```

#### `disconnect()`

Disconnect from Discord and clean up. It's safe to call at any time, including while a connection is still being made. The instance can connect again afterwards.

```javascript
await storage.disconnect();
```

### Errors

Errors are prefixed with the operation that failed (`Upload failed: …`, `Download failed: …`, `Delete failed: …`). When Discord itself returned the error, the original is kept as `error.cause`, and its `code` tells you what went wrong:

| Code | Meaning |
|---|---|
| `10003` | Unknown channel: check `channelId` |
| `10008` | Unknown message: wrong ID, or already deleted |
| `50001` | Missing access: the bot can't see the channel |
| `50013` | Missing permissions: often `Attach Files` |
| `40005` | File too large for the server's upload limit |

```javascript
try {
  await storage.getImageUrl(messageId);
} catch (error) {
  console.error(error.message, error.cause?.code);
}
```

Invalid arguments (such as a missing message ID or an oversized description) throw straight away, before any request is made.

### Rate limiting

discord.js already queues requests to stay within Discord's rate limits. If you want to stay well below them, use the `rateLimit` option:

```javascript
import { DiscordStorage, RateLimiter } from './src/index.js';

// At most 2 Discord API requests per second for this instance
const storage = new DiscordStorage({ token, channelId, rateLimit: { maxRequests: 2, windowMs: 1000 } });

// Or share one limit between several instances
const shared = new RateLimiter(5, 1000);
const a = new DiscordStorage({ token, channelId: channelA, rateLimit: shared });
const b = new DiscordStorage({ token, channelId: channelB, rateLimit: shared });
```

---

## Usage Examples

The [`examples/`](examples) folder has runnable versions of these.

### Basic Example

```javascript
import { DiscordStorage } from './src/index.js';

const storage = new DiscordStorage({
  token: process.env.DISCORD_BOT_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID
});

// Upload an image
const upload = await storage.upload('./photo.jpg', {
  description: 'My photo'
});

// Download it back
await storage.download(upload.messageId, './downloaded-photo.jpg');

// Clean up
await storage.delete(upload.messageId);
await storage.disconnect();
```

### Create an Image Gallery

Save message IDs rather than URLs, because URLs expire:

```javascript
// Upload multiple images
const imageFiles = ['img1.png', 'img2.png', 'img3.png'];
const gallery = [];
for (const file of imageFiles) {
  const { messageId, filename, uploadedAt } = await storage.upload(file);
  gallery.push({ messageId, filename, uploadedAt });
}
fs.writeFileSync('gallery.json', JSON.stringify(gallery, null, 2));

// Later: turn the index back into fresh URLs
for (const entry of JSON.parse(fs.readFileSync('gallery.json', 'utf8'))) {
  const { url } = await storage.getImageUrl(entry.messageId);
  console.log(entry.filename, url);
}
```

---

## Security Best Practices

1. **Never commit your `.env` file**: it contains your bot token (it's already in `.gitignore`)
2. **Use environment variables**: don't hardcode tokens in your code
3. **Rotate tokens regularly**: if a token is exposed, reset it in the Developer Portal immediately
4. **Limit bot permissions**: only grant the four permissions listed above
5. **Use a dedicated test server**: don't test on production Discord servers

---

## Limitations

### Discord Limits

- **File size**: bots can upload up to the server's upload limit, which depends on its boost level. Discord changes these limits from time to time, so check their current documentation. Oversized files fail with "file is larger than this server's upload limit".
- **Rate limits**: handled by discord.js; add the `rateLimit` option if you want to be gentler
- **Expiring URLs**: attachment URLs expire; message IDs don't
- **No guarantees**: Discord doesn't guarantee file permanence

### This Library's Limitations

- **No encryption**: Files are not encrypted
- **No versioning**: No file version control
- **Limited metadata**: Only basic file information stored
- **Single channel**: One channel per storage instance
- **No search**: `listUploads()` walks the channel history, so it slows down on busy channels

---

## Troubleshooting

### "An invalid token was provided"

- Check `DISCORD_BOT_TOKEN` in `.env`
- Reset the token in the Discord Developer Portal if needed

### "Channel … not found or not accessible"

- Make sure `DISCORD_CHANNEL_ID` is a channel ID (not a server or message ID)
- Check the bot is in that server and can see the channel

### "Channel … is not a text channel"

- Use a normal text channel, not a category or forum channel

### "Missing Permissions" or "Missing Access"

- The bot needs `View Channels`, `Send Messages`, `Attach Files` and `Read Message History` in the channel
- Check channel-level permission overrides as well as the bot's role

### Rate limiting

- discord.js waits out Discord's rate limits automatically
- For bulk operations, set the `rateLimit` option to spread requests out

---

## Project Structure

```
src/index.js          DiscordStorage class
src/RateLimiter.js    Optional client-side rate limiter
src/*.d.ts            TypeScript declarations
examples/             Runnable examples (npm run example / npm run advanced)
tests/                Offline test suite with a fake Discord client (npm test)
```

---

## Learning Resources

### Official Documentation

- [Discord.js Guide](https://discordjs.guide/)
- [Discord API Documentation](https://discord.com/developers/docs)
- [Node.js Documentation](https://nodejs.org/docs)

### Related Concepts

- REST APIs and HTTP requests
- OAuth2 authentication
- WebSocket connections
- File streaming in Node.js
- Async/await and Promises

---

## Licence

MIT License - See LICENSE file for details.

This licence applies to the code only. **Use of this code in production or in violation of Discord's Terms of Service is at your own risk.**

---

## Contributing

Contributions that improve:

- Code quality and error handling
- Documentation and examples
- Educational value
- Security best practices

Please run `npm test` before opening a pull request.

---

## FAQ

**Q: What are legitimate alternatives to this tool?**  
A: Consider: AWS S3, Cloudflare R2, Backblaze B2, Google Cloud Storage, Azure Blob Storage, etc.

**Q: Will Discord ban my account for testing this?**  
A: Potentially. Use at your own risk, preferably with a test account and test server.

**Q: Can I store non-image files?**  
A: Yes. Nothing in the library is image-specific, so any file type Discord accepts works.

---

## Acknowledgements

This project uses:
- [discord.js](https://discord.js.org/) - Discord API client library
- [dotenv](https://github.com/motdotla/dotenv) - Loads `.env` for the examples

---

**Remember: This is a learning tool. Always respect service terms and use official, sanctioned methods for production applications.**
