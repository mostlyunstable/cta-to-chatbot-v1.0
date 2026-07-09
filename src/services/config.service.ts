import { logger } from '../utils/logger';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;
let isConnected = false;

// Keys that the config service manages
const CONFIG_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'META_VERIFY_TOKEN',
  'META_APP_SECRET',
  'GEMINI_API_KEY',
  'SYSTEM_PROMPT',
  'BOT_ACTIVE',
];

const DEFAULT_SYSTEM_PROMPT = `You are a helpful and friendly customer support assistant for Global Peace Overseas.
Your goal is to respond to customers like a human, using short replies (2-3 lines).
If the customer asks a detailed question, give a clear pointwise explanation, but keep it concise.
Always stay polite and natural. Never say you are an AI unless directly asked.`;

export class ConfigService {
  /**
   * Initialize the config table and load values into memory.
   * Called once on server startup after DB connects.
   */
  static async init(dbPool: mysql.Pool): Promise<boolean> {
    pool = dbPool;
    let conn: mysql.PoolConnection | undefined;
    try {
      conn = await pool.getConnection();

      // Create config table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS bot_config (
          config_key VARCHAR(100) PRIMARY KEY,
          config_value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // Seed defaults from .env (only inserts if key doesn't already exist)
      await this.seedDefaults();

      isConnected = true;
      return true;
    } catch (error: any) {
      logger.error(`ConfigService init failed: ${error.message}`);
      return false;
    } finally {
      conn?.release();
    }
  }

  /**
   * Seed default config values from .env on first run.
   * Uses INSERT IGNORE so existing values are never overwritten.
   */
  private static async seedDefaults(): Promise<void> {
    if (!pool) return;

    // Placeholder values that indicate "not yet configured"
    const placeholders = [
      'your_whatsapp_access_token',
      'your_whatsapp_phone_number_id',
      'your_meta_app_secret',
      'your_gemini_api_key',
    ];

    const defaults: Record<string, string> = {
      WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || 'your_whatsapp_access_token',
      WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || 'your_whatsapp_phone_number_id',
      META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || 'my_secret_token_123',
      META_APP_SECRET: process.env.META_APP_SECRET || 'your_meta_app_secret',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'your_gemini_api_key',
      SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT,
      BOT_ACTIVE: 'true',
    };

    for (const [key, value] of Object.entries(defaults)) {
      // If the env value is a real credential (not a placeholder), always upsert it
      // so that DB placeholder values get replaced on redeploy.
      const isReal = !placeholders.includes(value);

      if (isReal) {
        await pool.query(
          'INSERT INTO bot_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = IF(config_value IN (?), VALUES(config_value), config_value)',
          [key, value, placeholders]
        );
      } else {
        // Only insert if the key doesn't exist yet (first-time seed)
        await pool.query(
          'INSERT IGNORE INTO bot_config (config_key, config_value) VALUES (?, ?)',
          [key, value]
        );
      }
    }
  }

  /**
   * Get a config value. Reads directly from the database to support horizontal scaling.
   * Falls back to .env if DB is not connected or value is missing.
   */
  static async get(key: string): Promise<string> {
    if (pool && isConnected) {
      try {
        const [rows] = await pool.query<mysql.RowDataPacket[]>(
          'SELECT config_value FROM bot_config WHERE config_key = ?',
          [key]
        );
        if (rows.length > 0) {
          return rows[0].config_value;
        }
      } catch (error: any) {
        logger.error(`Error fetching config ${key} from DB: ${error.message}`);
      }
    }

    // Fallback to .env
    return process.env[key] || '';
  }

  static async set(key: string, value: string): Promise<boolean> {
    if (!pool || !isConnected) return false;
    try {
      await pool.query(
        'INSERT INTO bot_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?',
        [key, value, value]
      );
      return true;
    } catch (error: any) {
      logger.error(`Config set error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all config values (for admin panel). Masks sensitive tokens.
   */
  static async getAll(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      result[key] = await this.get(key);
    }
    return result;
  }

  /**
   * Get all config values unmasked (for admin panel internal use).
   */
  static async getAllRaw(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      result[key] = await this.get(key);
    }
    return result;
  }

  /**
   * Check if the bot is currently active.
   */
  static async isBotActive(): Promise<boolean> {
    const val = await this.get('BOT_ACTIVE');
    return val === 'true';
  }

  /**
   * Check if DB-backed config is available.
   */
  static isReady(): boolean {
    return isConnected;
  }
}
