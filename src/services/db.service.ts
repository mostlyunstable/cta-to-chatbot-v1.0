import { logger } from '../utils/logger';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;
let isConnected = false;

export class DBService {
  /**
   * Initialize the database pool and create the chat_history table.
   * Returns the pool on success (for other services to use), or null on failure.
   * The server keeps running even if this fails.
   */
  static async init(): Promise<mysql.Pool | null> {
    let conn: mysql.PoolConnection | undefined;
    try {
      if (!pool) {
        pool = mysql.createPool({
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '3306'),
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'chatbot_db',
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          waitForConnections: true,
          connectionLimit: 5,
          queueLimit: 0,
          connectTimeout: 10000,
        });
      }

      // Test the connection
      conn = await pool.getConnection();

      // Create chat history table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS chat_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          platform VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
          role VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_platform_created (user_id, platform, created_at)
        )
      `);

      // Migration: Add the composite index if it doesn't exist
      try {
        const [indexes]: any = await conn.query("SHOW INDEX FROM chat_history WHERE Key_name = 'idx_user_platform_created'");
        if (indexes.length === 0) {
          await conn.query('ALTER TABLE chat_history ADD INDEX idx_user_platform_created (user_id, platform, created_at)');
          logger.info('Applied database index migration: idx_user_platform_created');
        }
      } catch (error: any) {
        logger.warn(`Migration check failed: ${error.message}`);
      }

      isConnected = true;
      return pool;
    } catch (error: any) {
      logger.error('❌ Database connection failed:', error.message);
      pool = null;
      isConnected = false;
      return null;
    } finally {
      conn?.release();
    }
  }

  /**
   * Quick connection test (for status endpoints).
   */
  static async testConnection(): Promise<boolean> {
    if (!pool) return false;
    let conn: mysql.PoolConnection | undefined;
    try {
      conn = await pool.getConnection();
      return true;
    } catch {
      return false;
    } finally {
      conn?.release();
    }
  }

  /**
   * Save a message to chat history.
   * Silently skips if DB is not connected.
   */
  static async saveMessage(userId: string, role: 'user' | 'model', content: string): Promise<void> {
    if (!pool || !isConnected) return;
    try {
      await pool.query(
        'INSERT INTO chat_history (user_id, platform, role, content) VALUES (?, ?, ?, ?)',
        [userId, 'whatsapp', role, content]
      );
    } catch (error: any) {
      logger.error('DB save error:', error.message);
    }
  }

  /**
   * Get the last N messages for a user for AI conversation context.
   * Returns empty array if DB is not connected.
   */
  static async getHistory(userId: string, limit: number = 10): Promise<{ role: string; parts: { text: string }[] }[]> {
    if (!pool || !isConnected) return [];
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT role, content FROM chat_history WHERE user_id = ? AND platform = ? ORDER BY created_at DESC LIMIT ?',
        [userId, 'whatsapp', limit]
      );
      return rows.reverse().map(row => ({
        role: row.role,
        parts: [{ text: row.content }]
      }));
    } catch (error: any) {
      logger.error('DB history fetch error:', error.message);
      return [];
    }
  }

  /**
   * Get all unique conversations (for the admin panel chat list).
   */
  static async getAllConversations(): Promise<{ userId: string; lastMessage: string; lastTime: string; messageCount: number }[]> {
    if (!pool || !isConnected) return [];
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(`
        SELECT 
          c1.user_id,
          c1.content as last_message,
          c1.created_at as last_time,
          counts.message_count
        FROM chat_history c1
        INNER JOIN (
            SELECT user_id, MAX(created_at) as max_time, COUNT(*) as message_count
            FROM chat_history
            GROUP BY user_id
        ) counts ON c1.user_id = counts.user_id AND c1.created_at = counts.max_time
        ORDER BY last_time DESC
      `);
      return rows.map(row => ({
        userId: row.user_id,
        lastMessage: row.last_message,
        lastTime: row.last_time,
        messageCount: row.message_count,
      }));
    } catch (error: any) {
      logger.error('DB conversations fetch error:', error.message);
      return [];
    }
  }
}
