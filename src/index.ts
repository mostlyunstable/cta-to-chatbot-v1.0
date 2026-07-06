import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import { DBService } from './services/db.service';
import { ConfigService } from './services/config.service';
import { AuthService } from './services/auth.service';
import webhookRoutes from './routes/webhook.routes';
import adminRoutes from './routes/admin.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(cors());  // Allow cross-origin requests from your Hostinger website
app.use(express.json());
app.use(cookieParser());

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

// ---- Start Server ----
app.listen(PORT, async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🤖 WhatsApp AI Chatbot — Server Started   ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   URL:    http://localhost:${PORT}              ║`);
  console.log(`║   Admin:  http://localhost:${PORT}/login.html   ║`);
  console.log(`║   Ping:   http://localhost:${PORT}/ping         ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Initialize database
  const dbPool = await DBService.init();

  if (dbPool) {
    console.log('✅ Database connected');

    // Initialize config and auth services
    const configOk = await ConfigService.init(dbPool);
    const authOk = await AuthService.init(dbPool);

    if (configOk) console.log('✅ Config service ready');
    if (authOk) console.log('✅ Auth service ready');

    console.log('');
    console.log('🎉 All systems operational. Admin panel is ready.');
  } else {
    console.log('⚠️  Database not reachable — server running in limited mode.');
    console.log('   → Admin panel login will not work until DB is connected.');
    console.log('   → Fix DB_HOST in .env and enable Remote MySQL in Hostinger.');
  }
  console.log('');
});
