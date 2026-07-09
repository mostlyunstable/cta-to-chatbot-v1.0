/// <reference path="./types/express.d.ts" />
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { logger } from './utils/logger';
import { DBService } from './services/db.service';
import { ConfigService } from './services/config.service';
import { AuthService } from './services/auth.service';
import webhookRoutes from './routes/webhook.routes';
import adminRoutes from './routes/admin.routes';
import { NextFunction, Request, Response } from 'express';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(helmet());
app.use(cors());  // Allow cross-origin requests from your Hostinger website
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cookieParser());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ---- Serve Admin Panel (static HTML files) ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Keep-Alive endpoint for UptimeRobot / cron-job.org ----
app.get('/ping', (_req, res) => {
  res.status(200).json({ status: 'alive', uptime: process.uptime() });
});

// ---- Redirect root to admin login ----
app.get('/', (_req, res) => {
  res.redirect('/login.html');
});

// ---- Mount Routes ----
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);

// ---- Initialize and Start Server ----
async function startServer() {
  logger.info('Initializing database...');
  const dbPool = await DBService.init();

  if (!dbPool) {
    logger.error('CRITICAL ERROR: Database initialization failed.');
    process.exit(1);
  }
  logger.info('Database connected');

  const configOk = await ConfigService.init(dbPool);
  const authOk = await AuthService.init(dbPool);

  if (!configOk || !authOk) {
    logger.error('CRITICAL ERROR: Config or Auth service initialization failed.');
    process.exit(1);
  }
  
  logger.info('Config service ready');
  logger.info('Auth service ready');

  // ---- Global Error Handler ----
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled error in route ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    logger.info('');
    logger.info('╔══════════════════════════════════════════════╗');
    logger.info('║   🤖 WhatsApp AI Chatbot — Server Started   ║');
    logger.info('╠══════════════════════════════════════════════╣');
    logger.info(`║   URL:    http://localhost:${PORT}              ║`);
    logger.info(`║   Admin:  http://localhost:${PORT}/login.html   ║`);
    logger.info(`║   Ping:   http://localhost:${PORT}/ping         ║`);
    logger.info('╚══════════════════════════════════════════════╝');
    logger.info('');
    logger.info('🎉 All systems operational. Admin panel is ready.');
    logger.info('');
  });
}

startServer().catch(err => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
