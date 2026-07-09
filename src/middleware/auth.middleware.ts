/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

/**
 * Middleware that protects admin routes.
 * Checks for a valid JWT in either:
 *   1. The `token` cookie (set by login page)
 *   2. The `Authorization: Bearer <token>` header
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Try cookie first, then Authorization header
  const token = req.cookies?.token || extractBearerToken(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const user = await AuthService.verifyTokenAndUser(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    return;
  }

  // Attach user info to request for downstream use
  req.adminUser = user;
  next();
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}
