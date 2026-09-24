import { Client, Events, GatewayIntentBits, AttachmentBuilder } from 'discord.js';
import { writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import https from 'https';
import http from 'http';

/** Discord's limit on message content, which holds the description */
const MAX_DESCRIPTION_LENGTH = 2000;

/** Discord API error code for a file over the server's upload limit */
const FILE_TOO_LARGE = 40005;

/**
 * Throw unless messageId looks like a Discord snowflake.
 * discord.js treats a missing ID as "fetch many", which would otherwise
 * make delete(undefined) report success without deleting anything.
 */
function assertMessageId(messageId) {
  if (typeof messageId !== 'string' || !/^\d+$/.test(messageId)) {
    throw new TypeError('messageId must be a Discord message ID string');
  }
}

/**
 * DiscordStorage - Educational Discord-based image storage library
 */
export class DiscordStorage {
  /**
   * Create a new DiscordStorage instance
   * @param {Object} config - Configuration object
   * @param {string} config.token - Discord bot token
   * @param {string} config.channelId - Discord channel ID for storage
   */
  constructor(config) {
    if (!config.token) {
      throw new Error('Discord bot token is required');
    }
    if (!config.channelId) {
      throw new Error('Discord channel ID is required');
    }

    this.token = config.token;
    this.channelId = config.channelId;
    this.client = null;
    this.isReady = false;
    this.readyPromise = null;
    this._abortConnect = null;
  }

  /**
   * Initialise the Discord client and connect.
   * Concurrent calls share one login attempt. A failed attempt is not cached,
   * so calling connect() again retries with a fresh client.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isReady) {
      return;
    }

    if (!this.readyPromise) {
      const attempt = this._login().catch((error) => {
        if (this.readyPromise === attempt) {
          this.readyPromise = null;
        }
        throw error;
      });
      this.readyPromise = attempt;
    }

    return this.readyPromise;
  }

  /**
   * Create the underlying discord.js client
   * @private
   */
  _createClient() {
    return new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });
  }

  /**
   * Log in with a new client and wait for it to become ready
   * @private
   */
  async _login() {
    const client = this._createClient();
    this.client = client;

    // Keep a permanent listener so client errors after login are logged
    // instead of crashing the process as unhandled 'error' events
    client.on(Events.Error, (error) => {
      console.error('❌ Discord client error:', error);
    });

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (callback) => (value) => {
          if (settled) {
            return;
          }
          settled = true;
          client.off(Events.ClientReady, onReady);
          client.off(Events.Error, onError);
          if (this._abortConnect === onError) {
            this._abortConnect = null;
          }
          callback(value);
        };
        const onReady = settle(resolve);
        const onError = settle(reject);

        client.once(Events.ClientReady, onReady);
        client.once(Events.Error, onError);
        this._abortConnect = onError;

        client.login(this.token).catch(onError);
      });

      if (this.client !== client) {
        throw new Error('Disconnected before the connection was ready');
      }
    } catch (error) {
      // If disconnect() already took this client, it destroys it as well
      if (this.client === client) {
        this.client = null;
        await Promise.resolve(client.destroy()).catch(() => {});
      }
      throw error;
    }

    this.isReady = true;
    console.log(`✅ Connected as ${client.user.tag}`);
  }

  /**
   * Upload a file to Discord
   * @param {string|Buffer} filePathOrBuffer - Path to file or Buffer containing file data
   * @param {Object} options - Upload options
   * @param {string} options.filename - Custom filename (required if using Buffer)
   * @param {string} options.description - Optional description/metadata (max 2000 characters)
   * @returns {Promise<Object>} Upload result with URL and metadata
   */
  async upload(filePathOrBuffer, options = {}) {
    let filename;
    if (Buffer.isBuffer(filePathOrBuffer)) {
      if (!options.filename) {
        throw new Error('Filename is required when uploading from Buffer');
      }
      filename = options.filename;
    } else if (typeof filePathOrBuffer === 'string' && filePathOrBuffer !== '') {
      filename = options.filename || basename(filePathOrBuffer);
    } else {
      throw new TypeError('Expected a file path or a Buffer');
    }

    const description = options.description || `Uploaded: ${filename}`;
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
    }

    try {
      // Read local files up front so a bad path fails before connecting
      const data = Buffer.isBuffer(filePathOrBuffer)
        ? filePathOrBuffer
        : await readFile(filePathOrBuffer);

      const channel = await this._getChannel();
      const message = await channel.send({
        content: description,
        files: [new AttachmentBuilder(data, { name: filename })],
        // The description is plain text, so never let it ping anyone
        allowedMentions: { parse: [] },
      });

      const uploadedAttachment = message.attachments.first();
      if (!uploadedAttachment) {
        throw new Error('Discord did not return the uploaded attachment');
      }

      return {
        success: true,
        url: uploadedAttachment.url,
        filename: uploadedAttachment.name,
        size: uploadedAttachment.size,
        messageId: message.id,
        description,
        uploadedAt: message.createdAt,
      };
    } catch (error) {
      if (error.code === FILE_TOO_LARGE) {
        throw new Error(`Upload failed: file is larger than this server's upload limit`, { cause: error });
      }
      throw new Error(`Upload failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Download a file from Discord by message ID
   * @param {string} messageId - Discord message ID containing the file
   * @param {string} outputPath - Path where to save the downloaded file
   * @returns {Promise<Object>} Download result with file info
   */
  async download(messageId, outputPath) {
    assertMessageId(messageId);
    if (typeof outputPath !== 'string' || outputPath === '') {
      throw new TypeError('outputPath must be a file path');
    }

    try {
      const channel = await this._getChannel();
      const message = await channel.messages.fetch(messageId);

      if (message.attachments.size === 0) {
        throw new Error('No attachments found in message');
      }

      const attachment = message.attachments.first();
      const fileData = await this._downloadFile(attachment.url);

      writeFileSync(outputPath, fileData);

      return {
        success: true,
        filename: attachment.name,
        size: attachment.size,
        savedTo: outputPath,
        downloadedAt: new Date(),
      };
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Get a fresh URL for an uploaded file by message ID.
   * Discord attachment URLs expire, so call this again rather than storing URLs.
   * @param {string} messageId - Discord message ID containing the file
   * @returns {Promise<Object>} File information including URL
   */
  async getImageUrl(messageId) {
    assertMessageId(messageId);

    try {
      const channel = await this._getChannel();
      const message = await channel.messages.fetch(messageId);

      if (message.attachments.size === 0) {
        throw new Error('No attachments found in message');
      }

      const attachment = message.attachments.first();

      return {
        url: attachment.url,
        filename: attachment.name,
        size: attachment.size,
        description: message.content,
        uploadedAt: message.createdAt,
      };
    } catch (error) {
      throw new Error(`Failed to get image URL: ${error.message}`, { cause: error });
    }
  }

  /**
   * List recent uploads from the channel
   * @param {number} limit - Maximum number of messages to fetch (default: 10, max: 100)
   * @returns {Promise<Array>} Array of image metadata
   */
  async listUploads(limit = 10) {
    try {
      const channel = await this._getChannel();
      const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) });

      const uploads = [];
      messages.forEach((message) => {
        if (message.attachments.size > 0) {
          const attachment = message.attachments.first();
          uploads.push({
            messageId: message.id,
            url: attachment.url,
            filename: attachment.name,
            size: attachment.size,
            description: message.content,
            uploadedAt: message.createdAt,
          });
        }
      });

      return uploads;
    } catch (error) {
      throw new Error(`Failed to list uploads: ${error.message}`, { cause: error });
    }
  }

  /**
   * Delete an uploaded file by message ID
   * @param {string} messageId - Discord message ID to delete
   * @returns {Promise<Object>} Deletion result
   */
  async delete(messageId) {
    assertMessageId(messageId);

    try {
      const channel = await this._getChannel();
      const message = await channel.messages.fetch(messageId);
      await message.delete();

      return {
        success: true,
        messageId,
        deletedAt: new Date(),
      };
    } catch (error) {
      throw new Error(`Delete failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Connect if needed and fetch the storage channel
   * @private
   */
  async _getChannel() {
    await this.connect();

    const client = this.client;
    if (!client) {
      throw new Error('Disconnected from Discord');
    }

    let channel;
    try {
      channel = await client.channels.fetch(this.channelId);
    } catch (error) {
      throw new Error(
        `Channel ${this.channelId} not found or not accessible (${error.message})`,
        { cause: error },
      );
    }

    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }
    if (!channel.isTextBased()) {
      throw new Error(`Channel ${this.channelId} is not a text channel`);
    }

    return channel;
  }

  /**
   * Helper method to download file from URL
   * @private
   */
  _downloadFile(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Disconnect from Discord. Safe to call at any time, including while a
   * connection is still being established (the pending connect() rejects).
   * The instance can connect again afterwards.
   * @returns {Promise<void>}
   */
  async disconnect() {
    const client = this.client;
    if (!client) {
      return;
    }

    // Reset state before awaiting so a concurrent connect() starts cleanly
    this.client = null;
    this.isReady = false;
    this.readyPromise = null;
    if (this._abortConnect) {
      this._abortConnect(new Error('Disconnected before the connection was ready'));
    }

    await client.destroy();
    console.log('✅ Disconnected from Discord');
  }
}

export default DiscordStorage;

