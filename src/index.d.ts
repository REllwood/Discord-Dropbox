/**
 * Configuration options for DiscordStorage
 */
export interface DiscordStorageConfig {
  /** Discord bot token */
  token: string;
  /** Discord channel ID for storage */
  channelId: string;
  /** Abort downloads that take longer than this many milliseconds (default: 60000) */
  downloadTimeoutMs?: number;
}

/**
 * Options for uploading files
 */
export interface UploadOptions {
  /** Custom filename (required when uploading from Buffer) */
  filename?: string;
  /** Optional description/metadata, posted as plain text (max 2000 characters) */
  description?: string;
}

/**
 * Result of a successful upload
 */
export interface UploadResult {
  /** Whether the upload was successful */
  success: boolean;
  /** Direct URL to the uploaded file */
  url: string;
  /** Filename of the uploaded file */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Discord message ID (needed for download/delete operations) */
  messageId: string;
  /** Description/metadata */
  description: string;
  /** Upload timestamp */
  uploadedAt: Date;
}

/**
 * Result of a successful download
 */
export interface DownloadResult {
  /** Whether the download was successful */
  success: boolean;
  /** Filename of the downloaded file */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Path where the file was saved */
  savedTo: string;
  /** Download timestamp */
  downloadedAt: Date;
}

/**
 * Information about an uploaded image
 */
export interface ImageInfo {
  /** Direct URL to the image */
  url: string;
  /** Filename */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Description/metadata */
  description: string;
  /** Upload timestamp */
  uploadedAt: Date;
}

/**
 * Metadata about an upload
 */
export interface UploadMetadata {
  /** Discord message ID */
  messageId: string;
  /** Direct URL to the file */
  url: string;
  /** Filename */
  filename: string;
  /** File size in bytes */
  size: number;
  /** Description/metadata */
  description: string;
  /** Upload timestamp */
  uploadedAt: Date;
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  /** Whether the deletion was successful */
  success: boolean;
  /** Message ID that was deleted */
  messageId: string;
  /** Deletion timestamp */
  deletedAt: Date;
}

/**
 * DiscordStorage - Educational Discord-based image storage library
 * 
 * ⚠️ WARNING: This is for educational purposes only!
 * Using Discord as a storage service violates Discord's Terms of Service.
 * Do NOT use this in production environments.
 */
export class DiscordStorage {
  /**
   * Create a new DiscordStorage instance
   * @param config - Configuration object
   */
  constructor(config: DiscordStorageConfig);

  /**
   * Initialise the Discord client and connect.
   * Concurrent calls share one login; a failed login can be retried.
   */
  connect(): Promise<void>;

  /**
   * Upload a file to Discord.
   * Errors from Discord are wrapped, with the original error kept as `cause`.
   * @param filePathOrBuffer - Path to file or Buffer containing file data
   * @param options - Upload options
   * @returns Upload result with URL and metadata
   */
  upload(
    filePathOrBuffer: string | Buffer,
    options?: UploadOptions
  ): Promise<UploadResult>;

  /**
   * Download a file from Discord by message ID. The file is streamed to disk
   * and only appears at `outputPath` once the download has fully succeeded.
   * @param messageId - Discord message ID containing the image
   * @param outputPath - Path where to save the downloaded file
   * @returns Download result with file info
   */
  download(messageId: string, outputPath: string): Promise<DownloadResult>;

  /**
   * Get a fresh URL for an uploaded file by message ID.
   * Discord attachment URLs expire, so call this again rather than storing URLs.
   * @param messageId - Discord message ID containing the image
   * @returns Image information including URL
   */
  getImageUrl(messageId: string): Promise<ImageInfo>;

  /**
   * List recent uploads made by this bot, newest first.
   * Pages back through the channel history until `limit` uploads are found
   * or the history runs out. Messages from other users are skipped.
   * @param limit - Maximum number of uploads to return (default: 10)
   * @returns Array of upload metadata
   */
  listUploads(limit?: number): Promise<UploadMetadata[]>;

  /**
   * Delete an uploaded image by message ID
   * @param messageId - Discord message ID to delete
   * @returns Deletion result
   */
  delete(messageId: string): Promise<DeleteResult>;

  /**
   * Disconnect from Discord. Rejects any pending connect(); the instance
   * can connect again afterwards.
   */
  disconnect(): Promise<void>;
}

export default DiscordStorage;

