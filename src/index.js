import { Client, Events, GatewayIntentBits, AttachmentBuilder } from 'discord.js';
import { createWriteStream } from 'fs';
import { readFile, rename, rm } from 'fs/promises';
import { basename } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/** Discord's limit on message content, which holds the description */
const MAX_DESCRIPTION_LENGTH = 2000;

/** Discord API error code for a file over the server's upload limit */
const FILE_TOO_LARGE = 40005;

/** Default time allowed for a whole download before it is aborted */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

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
   * @param {number} [config.downloadTimeoutMs=60000] - Abort downloads that take longer than this
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
    this.downloadTimeoutMs = config.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    if (!Number.isFinite(this.downloadTimeoutMs) || this.downloadTimeoutMs <= 0) {
      throw new RangeError('downloadTimeoutMs must be a positive number');
    }
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
      await this._downloadFile(attachment.url, outputPath);

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
   * List recent uploads made by this bot, newest first.
   * Pages back through the channel history until `limit` uploads are found
   * or the history runs out. Messages from other users are skipped.
   * @param {number} limit - Maximum number of uploads to return (default: 10)
   * @returns {Promise<Array>} Array of upload metadata
   */
  async listUploads(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('limit must be a positive whole number');
    }

    try {
      const channel = await this._getChannel();
      const botId = this.client?.user?.id;
      if (!botId) {
        throw new Error('Disconnected from Discord');
      }

      const uploads = [];
      let before;

      while (uploads.length < limit) {
        const page = await channel.messages.fetch({ limit: 100, before });
        if (page.size === 0) {
          break;
        }

        for (const message of page.values()) {
          if (message.author.id !== botId || message.attachments.size === 0) {
            continue;
          }

          const attachment = message.attachments.first();
          uploads.push({
            messageId: message.id,
            url: attachment.url,
            filename: attachment.name,
            size: attachment.size,
            description: message.content,
            uploadedAt: message.createdAt,
          });

          if (uploads.length === limit) {
            break;
          }
        }

        // Pages come newest first, so the last key is the oldest message
        before = page.lastKey();
      }

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
   * Stream a file from a URL to disk. Writes to a temporary ".part" file and
   * renames it on success, so a failed download never leaves a partial file.
   * @private
   */
  async _downloadFile(url, outputPath) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.downloadTimeoutMs),
    });

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    const partialPath = `${outputPath}.part`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));
      await rename(partialPath, outputPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      throw error;
    }
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

