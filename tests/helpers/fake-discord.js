import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Collection, Events } from 'discord.js';
import { DiscordStorage } from '../../src/index.js';

let nextId = 1000;
const snowflake = () => String(nextId++);

/**
 * Build an error shaped like discord.js's DiscordAPIError
 */
export function apiError(code, message, status = 404) {
  const error = new Error(message);
  error.name = 'DiscordAPIError';
  error.code = code;
  error.status = status;
  return error;
}

/**
 * In-memory stand-in for a discord.js text channel.
 *
 * `store` is what Discord holds. Like discord.js, the channel also keeps a
 * client-side `messages.cache` of the Message objects it has handed out, and
 * those keep the attachment URLs they were created with. Every API request
 * is recorded in `requests`.
 */
export class FakeChannel {
  constructor(id = 'channel-1', { botUser = { id: 'bot-user', tag: 'StorageBot#0001' } } = {}) {
    this.id = id;
    this.botUser = botUser;
    this.store = new Map();
    this.sent = [];
    this.requests = [];
    this._signature = 1;
    this.messages = {
      cache: new Map(),
      fetch: async (options) => this._fetch(options),
      delete: async (messageId) => this._delete(messageId),
    };
  }

  isTextBased() {
    return true;
  }

  async send(options) {
    this.sent.push(options);
    this.requests.push('POST message');
    const message = await this.post(this.botUser, options);
    return this._toClient(message);
  }

  /**
   * Post a message with files as `author`, as if from another Discord client
   */
  async post(author, { content = '', files = [] } = {}) {
    const attachments = new Collection();
    for (const file of files) {
      const data = Buffer.isBuffer(file.attachment)
        ? file.attachment
        : await readFile(file.attachment);
      const id = snowflake();
      attachments.set(id, { id, name: file.name, size: data.length, data });
    }
    return this.addMessage({ author, content, attachments });
  }

  /**
   * Add a message to the channel, as if it had been posted by `author`
   */
  addMessage({ author, content = '', attachments = new Collection() }) {
    const message = { id: snowflake(), author, content, attachments, createdAt: new Date() };
    this.store.set(message.id, message);
    return message;
  }

  /**
   * Re-sign every attachment URL, as happens when Discord's signed URLs expire.
   * URLs handed out before this call stop working.
   */
  expireUrls() {
    this._signature += 1;
  }

  /**
   * The data behind an attachment URL, if that URL is currently valid
   */
  cdnLookup(url) {
    for (const message of this.store.values()) {
      for (const attachment of message.attachments.values()) {
        if (this._url(attachment) === url) {
          return attachment.data;
        }
      }
    }
    return null;
  }

  _url(attachment) {
    return `https://cdn.discordapp.com/attachments/${this.id}/${attachment.id}/${attachment.name}?ex=${this._signature}`;
  }

  /**
   * Build the Message discord.js would create from an API response, and cache it
   */
  _toClient(stored) {
    const attachments = new Collection();
    for (const [id, { data, ...attachment }] of stored.attachments) {
      attachments.set(id, { ...attachment, url: this._url(attachment) });
    }
    const message = {
      id: stored.id,
      author: stored.author,
      content: stored.content,
      createdAt: stored.createdAt,
      attachments,
      delete: async () => {
        await this._delete(stored.id);
        return message;
      },
    };
    this.messages.cache.set(message.id, message);
    return message;
  }

  /**
   * Mirrors MessageManager.fetch(): a single message comes from the cache
   * unless `force` is set; a page of messages always comes from the API.
   */
  async _fetch(options) {
    const single = typeof options === 'string' ? { message: options } : options ?? {};

    if (single.message) {
      if (!single.force && this.messages.cache.has(single.message)) {
        return this.messages.cache.get(single.message);
      }
      this.requests.push(`GET message ${single.message}`);
      const stored = this.store.get(single.message);
      if (!stored) {
        throw apiError(10008, 'Unknown Message');
      }
      return this._toClient(stored);
    }

    this.requests.push('GET messages');
    const { limit = 50, before } = single;
    // Newest first, like the Discord API
    const ordered = [...this.store.values()].sort((a, b) => Number(b.id) - Number(a.id));
    const start = before ? ordered.findIndex((m) => Number(m.id) < Number(before)) : 0;
    const page = start === -1 ? [] : ordered.slice(start, start + limit);
    return new Collection(page.map((m) => [m.id, this._toClient(m)]));
  }

  /**
   * Mirrors MessageManager.delete(): one API request. The cache is left alone,
   * because discord.js only evicts deleted messages on a gateway event.
   */
  async _delete(messageId) {
    this.requests.push(`DELETE message ${messageId}`);
    if (!this.store.delete(messageId)) {
      throw apiError(10008, 'Unknown Message');
    }
  }
}

/**
 * In-memory stand-in for a discord.js Client
 */
export class FakeClient extends EventEmitter {
  constructor({ channels = [], loginError = null, readyDelay = 0 } = {}) {
    super();
    this.loginError = loginError;
    this.readyDelay = readyDelay;
    this.loginCalls = 0;
    this.destroyed = false;
    this.user = null;
    this._channels = new Map(channels.map((channel) => [channel.id, channel]));
    this.channels = {
      fetch: async (id) => {
        const channel = this._channels.get(id);
        if (!channel) {
          throw apiError(10003, 'Unknown Channel');
        }
        return channel;
      },
    };
  }

  async login(token) {
    this.loginCalls += 1;
    if (this.loginError) {
      throw this.loginError;
    }
    this._readyTimer = setTimeout(() => {
      this.user = { id: 'bot-user', tag: 'StorageBot#0001' };
      this.emit(Events.ClientReady, this);
    }, this.readyDelay);
    return token;
  }

  async destroy() {
    clearTimeout(this._readyTimer);
    this.destroyed = true;
    this.user = null;
  }
}

/**
 * Create a storage instance whose clients are fakes sharing the same channels.
 * `clientOptions` may be a function of the attempt number (0, 1, ...).
 */
export function createTestStorage(t, { clientOptions = {}, channels, config = {} } = {}) {
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});

  const channel = new FakeChannel('channel-1');
  const available = channels ?? [channel];
  const clients = [];
  const storage = new DiscordStorage({ token: 'token', channelId: 'channel-1', ...config });
  storage._createClient = () => {
    const options = typeof clientOptions === 'function'
      ? clientOptions(clients.length)
      : clientOptions;
    const client = new FakeClient({ channels: available, ...options });
    clients.push(client);
    return client;
  };

  return { storage, channel, clients };
}

/**
 * Serve a fake channel's attachments through a mocked global fetch.
 * Expired URLs get a 404, as they do from Discord's CDN.
 */
export function mockCdn(t, channel) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const data = channel.cdnLookup(url);
    return data ? new Response(data) : new Response('This content is no longer available.', { status: 404 });
  });
}
