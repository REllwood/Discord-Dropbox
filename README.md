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

- Node.js 18.0.0 or higher
- A Discord account
- A Discord server where you can add a bot

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - Server Members Intent
   - Message Content Intent
5. Copy the bot token (keep this secret!)
6. Go to OAuth2 → URL Generator:
   - Select scopes: `bot`
   - Select permissions: `Send Messages`, `Read Message History`, `View Channels`
7. Copy the generated URL and open it to add the bot to your server

### 2. Get Your Channel ID

1. Open Discord and enable Developer Mode:
   - User Settings → App Settings → Advanced → Developer Mode
2. Right-click the channel where you want to store images
3. Click "Copy ID"

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

Create a `.env` file in the project root:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
```

### 5. Run Examples

```bash
# Basic usage example
npm run example

# Or run the advanced example
node examples/advanced-usage.js
```

---

## 📖 API Documentation

### Constructor

```javascript
import { DiscordStorage } from 'discord-image-storage';

const storage = new DiscordStorage({
  token: 'YOUR_BOT_TOKEN',
  channelId: 'YOUR_CHANNEL_ID'
});
```

### Methods

#### `connect()`

Connect to Discord. This is automatically called by other methods if not connected.

```javascript
await storage.connect();
```

#### `upload(filePathOrBuffer, options)`

Upload an image to Discord.

**Parameters:**
- `filePathOrBuffer` (string|Buffer): File path or Buffer containing image data
- `options` (Object):
  - `filename` (string): Custom filename (required if using Buffer)
  - `description` (string): Optional description/metadata

**Returns:** Promise<Object>
- `success` (boolean)
- `url` (string): Direct URL to the uploaded image
- `filename` (string)
- `size` (number): File size in bytes
- `messageId` (string): Discord message ID (needed for download/delete)
- `description` (string)
- `uploadedAt` (Date)

**Example:**

```javascript
// Upload from file path
const result = await storage.upload('./image.png', {
  description: 'My awesome image'
});

// Upload from buffer
const buffer = fs.readFileSync('./image.png');
const result = await storage.upload(buffer, {
  filename: 'image.png',
  description: 'Uploaded from buffer'
});

console.log('Image URL:', result.url);
console.log('Message ID:', result.messageId);
```

#### `download(messageId, outputPath)`

Download an image from Discord by message ID.

**Parameters:**
- `messageId` (string): Discord message ID containing the image
- `outputPath` (string): Path where to save the downloaded file

**Returns:** Promise<Object>
- `success` (boolean)
- `filename` (string)
- `size` (number)
- `savedTo` (string)
- `downloadedAt` (Date)

**Example:**

```javascript
await storage.download('123456789', './downloaded-image.png');
```

#### `getImageUrl(messageId)`

Get the URL and metadata of an uploaded image.

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
const info = await storage.getImageUrl('123456789');
console.log('Direct URL:', info.url);
```

#### `listUploads(limit)`

List recent uploads from the channel.

**Parameters:**
- `limit` (number): Maximum number of uploads to fetch (default: 10, max: 100)

**Returns:** Promise<Array>

**Example:**

```javascript
const uploads = await storage.listUploads(20);
uploads.forEach(upload => {
  console.log(`${upload.filename}: ${upload.url}`);
});
```

#### `delete(messageId)`

Delete an uploaded image.

**Parameters:**
- `messageId` (string): Discord message ID to delete

**Returns:** Promise<Object>
- `success` (boolean)
- `messageId` (string)
- `deletedAt` (Date)

**Example:**

```javascript
await storage.delete('123456789');
```

#### `disconnect()`

Disconnect from Discord and clean up resources.

```javascript
await storage.disconnect();
```

---

## Usage Examples

### Basic Example

```javascript
import { DiscordStorage } from 'discord-image-storage';

const storage = new DiscordStorage({
  token: process.env.DISCORD_BOT_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID
});

// Upload an image
const upload = await storage.upload('./photo.jpg', {
  description: 'My photo'
});

console.log('Uploaded to:', upload.url);

// Download it back
await storage.download(upload.messageId, './downloaded-photo.jpg');

// Clean up
await storage.delete(upload.messageId);
await storage.disconnect();
```

### Create an Image Gallery

```javascript
// Upload multiple images
const imageFiles = ['img1.png', 'img2.png', 'img3.png'];
for (const file of imageFiles) {
  await storage.upload(file);
}

// Create gallery index
const gallery = await storage.listUploads(50);
const galleryData = gallery.map(img => ({
  url: img.url,
  filename: img.filename,
  uploadedAt: img.uploadedAt
}));

fs.writeFileSync('gallery.json', JSON.stringify(galleryData, null, 2));
```

---

## Security Best Practices

1. **Never commit your `.env` file** - It contains sensitive tokens
2. **Use environment variables** - Don't hardcode tokens in your code
3. **Rotate tokens regularly** - If exposed, regenerate your bot token immediately
4. **Limit bot permissions** - Only grant necessary permissions
5. **Use a dedicated test server** - Don't test on production Discord servers

---

## Limitations

### Discord API Limits

- **File size**: ~~25 MB~~ 15 MB (free users), 50 MB (Nitro users), 500 MB (Nitro Basic users)
- **Rate limits**: 50 requests per second per bot token
- **Storage duration**: Discord may delete old attachments
- **No guarantees**: Discord doesn't guarantee file permanence

### This Library's Limitations

- **No encryption**: Files are not encrypted
- **No versioning**: No file version control
- **Limited metadata**: Only basic file information stored
- **Single channel**: One channel per storage instance
- **No search**: Limited file search capabilities

---

## Troubleshooting

### "Invalid token" error

- Verify your bot token is correct in `.env`
- Regenerate the token in Discord Developer Portal if needed

### "Channel not found" error

- Ensure your channel ID is correct
- Verify the bot has access to the channel
- Check bot permissions (View Channel, Send Messages, Read Message History)

### "Missing Access" error

- The bot needs proper permissions in the channel
- Invite the bot with correct OAuth2 scopes

### Rate limiting issues

- Discord enforces strict rate limits
- Add delays between bulk operations
- Consider implementing exponential backoff

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

## License

MIT License - See LICENSE file for details.

This license applies to the code only. **Use of this code in production or in violation of Discord's Terms of Service is at your own risk.**

---

## Contributing

Contributions that improve:

- Code quality and error handling
- Documentation and examples
- Educational value
- Security best practices

---

## FAQ

**Q: What are legitimate alternatives to this tool?**  
A: Consider: AWS S3, Cloudflare R2, Backblaze B2, Google Cloud Storage, Azure Blob Storage, etc.

**Q: Will Discord ban my account for testing this?**  
A: Potentially. Use at your own risk, preferably with a test account and test server.

**Q: Can I store non-image files?**  
A: The code supports any file type that Discord accepts, but the library is optimised for images. You'd need to modify it for other file types.

---

## Acknowledgments

This project uses:
- [discord.js](https://discord.js.org/) - Discord API client library
- [dotenv](https://github.com/motdotla/dotenv) - Environment variable management

---

**Remember: This is a learning tool. Always respect service terms and use official, sanctioned methods for production applications.**

