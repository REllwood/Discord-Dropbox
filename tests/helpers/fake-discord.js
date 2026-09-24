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
 * In-memory stand-in for a discord.js text channel
 */
export class FakeChannel {
  constructor(id = 'channel-1', { botUser = { id: 'bot-user', tag: 'StorageBot#0001' } } = {}) {
    this.id = id;
    this.botUser = botUser;
    this.store = new Map();
    this.sent = [];
    this.messages = {
      fetch: async (idOrOptions) => this._fetch(idOrOptions),
    };
  }

  isTextBased() {
    return true;
  }

  async send(options) {
    this.sent.push(options);
    const attachments = new Collection();
    for (const file of options.files ?? []) {
      const data = Buffer.isBuffer(file.attachment)
        ? file.attachment
        : await readFile(file.attachment);
      const id = snowflake();
      attachments.set(id, {
        id,
        name: file.name,
        size: data.length,
        url: `https://cdn.discordapp.com/attachments/${this.id}/${id}/${file.name}?ex=1&is=1&hm=1`,
        data,
      });
    }
    return this.addMessage({ author: this.botUser, content: options.content, attachments });
  }

  /**
   * Add a message to the channel, as if it had been posted by `author`
   */
  addMessage({ author, content = '', attachments = new Collection() }) {
    const message = {
      id: snowflake(),
      author,
      content,
      attachments,
      createdAt: new Date(),
      delete: async () => {
        this.store.delete(message.id);
        return message;
      },
    };
    this.store.set(message.id, message);
    return message;
  }

  async _fetch(idOrOptions) {
    if (typeof idOrOptions === 'string') {
      const message = this.store.get(idOrOptions);
      if (!message) {
        throw apiError(10008, 'Unknown Message');
      }
      return message;
    }

    const { limit = 50, before } = idOrOptions ?? {};
    // Newest first, like the Discord API
    const ordered = [...this.store.values()].sort((a, b) => Number(b.id) - Number(a.id));
    const start = before ? ordered.findIndex((m) => Number(m.id) < Number(before)) : 0;
    const page = start === -1 ? [] : ordered.slice(start, start + limit);
    return new Collection(page.map((m) => [m.id, m]));
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
  t.mock.method(console, 'log', () => {});
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
