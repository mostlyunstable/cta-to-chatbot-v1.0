import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      adminUser?: { id: number; username: string };
    }
  }
}
