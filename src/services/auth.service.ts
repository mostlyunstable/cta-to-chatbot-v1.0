import { logger } from '../utils/logger';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  logger.error('❌ CRITICAL ERROR: JWT_SECRET environment variable is missing.');
  process.exit(1);
}
const JWT_EXPIRY = '24h';

export class AuthService {
  /**
   * Initialize the admin_users table and seed a default admin account.
   */
  static async init(dbPool: mysql.Pool): Promise<boolean> {
    pool = dbPool;
    let conn: mysql.PoolConnection | undefined;
    try {
      conn = await pool.getConnection();

      await conn.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

      // Check if the configured admin exists
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT * FROM admin_users WHERE username = ?',
        [adminUsername]
      );

      const hash = await bcrypt.hash(adminPassword, 12);
      if (rows.length === 0) {
        // Seed default admin account
        await conn.query(
          'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)',
          [adminUsername, hash]
        );
        logger.info(`👤 Admin account created (username: "${adminUsername}")`);
      } else {
        // Update its password just in case it was changed in .env
        await conn.query(
          'UPDATE admin_users SET password_hash = ? WHERE username = ?',
          [hash, adminUsername]
        );
        logger.info(`👤 Admin account updated/verified (username: "${adminUsername}")`);
      }

      return true;
    } catch (error: any) {
      logger.error('❌ AuthService init failed:', error.message);
      return false;
    } finally {
      conn?.release();
    }
  }

  /**
   * Authenticate an admin user. Returns an object with token on success, error on failure.
   */
  static async login(username: string, password: string): Promise<{ token: string | null; error?: string }> {
    if (!pool) {
      logger.info('[DEBUG] AuthService.login failed: pool is null');
      return { token: null, error: 'Database connection is not initialized. Please verify DB credentials in environment variables.' };
    }
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id, username, password_hash FROM admin_users WHERE username = ?',
        [username]
      );

      if (rows.length === 0) {
        logger.info('[DEBUG] AuthService.login failed: User not found in DB');
        return { token: null, error: 'Invalid username or password' };
      }

      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);
      
      logger.info(`[DEBUG] AuthService.login: comparing provided password with hash: ${isMatch}`);

      if (!isMatch) {
        logger.info('[DEBUG] AuthService.login failed: Password mismatch');
        return { token: null, error: 'Invalid username or password' };
      }

      // Generate JWT
      const token = jwt.sign(
        { id: user.id, username: user.username, hash: user.password_hash.substring(0, 10) },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      logger.info('[DEBUG] AuthService.login succeeded');
      return { token };
    } catch (error: any) {
      logger.error('[DEBUG] AuthService.login error:', error.message);
      return { token: null, error: `Database error: ${error.message}` };
    }
  }

  /**
   * Verify a JWT token and ensure the user's password hasn't changed.
   */
  static async verifyTokenAndUser(token: string): Promise<{ id: number; username: string } | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; hash?: string };
      if (!decoded.id) return null;

      if (!pool) return null;
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT password_hash FROM admin_users WHERE id = ?',
        [decoded.id]
      );
      if (rows.length === 0) return null;

      if (decoded.hash) {
        const currentHash = rows[0].password_hash.substring(0, 10);
        if (currentHash !== decoded.hash) return null; // Password was changed
      }

      return { id: decoded.id, username: decoded.username };
    } catch {
      return null;
    }
  }

  /**
   * Change the password for an admin user.
   */
  static async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!pool) return { success: false, message: 'Database not connected' };

    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT password_hash FROM admin_users WHERE id = ?',
        [userId]
      );

      if (rows.length === 0) return { success: false, message: 'User not found' };

      const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!isMatch) return { success: false, message: 'Current password is incorrect' };

      if (newPassword.length < 6) return { success: false, message: 'New password must be at least 6 characters' };

      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query(
        'UPDATE admin_users SET password_hash = ? WHERE id = ?',
        [hash, userId]
      );

      return { success: true, message: 'Password updated successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}
