import { Client, GatewayIntentBits, AttachmentBuilder } from 'discord.js';
import { createReadStream, writeFileSync } from 'fs';
import { basename } from 'path';
import https from 'https';
import http from 'http';

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
  }

  /**
   * Initialise the Discord client and connect
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isReady) {
      return;
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise((resolve, reject) => {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
        ],
      });

      this.client.once('ready', () => {
        console.log(`✅ Connected as ${this.client.user.tag}`);
        this.isReady = true;
        resolve();
      });

      this.client.once('error', (error) => {
        console.error('❌ Discord client error:', error);
        reject(error);
      });

      this.client.login(this.token).catch(reject);
    });

    return this.readyPromise;
  }

  /**
   * Upload an image to Discord
   * @param {string|Buffer} filePathOrBuffer - Path to file or Buffer containing file data
   * @param {Object} options - Upload options
   * @param {string} options.filename - Custom filename (required if using Buffer)
   * @param {string} options.description - Optional description/metadata
   * @returns {Promise<Object>} Upload result with URL and metadata
   */
  async upload(filePathOrBuffer, options = {}) {
    await this.connect();

    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }

    let attachment;
    let filename;

    if (Buffer.isBuffer(filePathOrBuffer)) {
      if (!options.filename) {
        throw new Error('Filename is required when uploading from Buffer');
      }
      filename = options.filename;
      attachment = new AttachmentBuilder(filePathOrBuffer, { name: filename });
    } else {
      filename = options.filename || basename(filePathOrBuffer);
      attachment = new AttachmentBuilder(filePathOrBuffer, { name: filename });
    }

    const description = options.description || `Uploaded: ${filename}`;
    
    try {
      const message = await channel.send({
        content: description,
        files: [attachment],
      });

      const uploadedAttachment = message.attachments.first();
      
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
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * Download an image from Discord by message ID
   * @param {string} messageId - Discord message ID containing the image
   * @param {string} outputPath - Path where to save the downloaded file
   * @returns {Promise<Object>} Download result with file info
   */
  async download(messageId, outputPath) {
    await this.connect();

    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }

    try {
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
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Get URL of an uploaded image by message ID
   * @param {string} messageId - Discord message ID containing the image
   * @returns {Promise<Object>} Image information including URL
   */
  async getImageUrl(messageId) {
    await this.connect();

    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }

    try {
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
      throw new Error(`Failed to get image URL: ${error.message}`);
    }
  }

  /**
   * List recent uploads from the channel
   * @param {number} limit - Maximum number of messages to fetch (default: 10, max: 100)
   * @returns {Promise<Array>} Array of image metadata
   */
  async listUploads(limit = 10) {
    await this.connect();

    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }

    try {
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
      throw new Error(`Failed to list uploads: ${error.message}`);
    }
  }

  /**
   * Delete an uploaded image by message ID
   * @param {string} messageId - Discord message ID to delete
   * @returns {Promise<Object>} Deletion result
   */
  async delete(messageId) {
    await this.connect();

    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel) {
      throw new Error(`Channel ${this.channelId} not found`);
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();

      return {
        success: true,
        messageId,
        deletedAt: new Date(),
      };
    } catch (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
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
   * Disconnect from Discord
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client && this.isReady) {
      await this.client.destroy();
      this.isReady = false;
      this.client = null;
      console.log('✅ Disconnected from Discord');
    }
  }
}

export default DiscordStorage;

