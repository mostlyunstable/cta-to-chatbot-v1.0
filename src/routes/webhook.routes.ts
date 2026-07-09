/// <reference path="../types/express.d.ts" />
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { logger } from '../utils/logger';
import { MetaService } from '../services/meta.service';
import { AIService } from '../services/ai.service';
import { ConfigService } from '../services/config.service';

const router = Router();

// ============================================================
// WhatsApp Webhook — Verification (GET)
// ============================================================
router.get('/whatsapp', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = await ConfigService.get('META_VERIFY_TOKEN');

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed — token mismatch');
    res.sendStatus(403);
  }
});

// ============================================================
// WhatsApp Webhook — Incoming Messages (POST)
// ============================================================
router.post('/whatsapp', async (req: Request, res: Response) => {
  // ---- SECURITY: VERIFY META WEBHOOK SIGNATURE ----
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = await ConfigService.get('META_APP_SECRET');
  
  if (appSecret && appSecret !== 'your_meta_app_secret') {
    if (!signature) {
      logger.warn('Meta webhook missing signature. Rejecting.');
      res.status(401).send('Missing signature');
      return;
    }
    const rawBody = (req as any).rawBody;
    if (rawBody) {
      const hmac = crypto.createHmac('sha256', appSecret);
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
      if (signature !== digest) {
        logger.warn('Meta webhook signature mismatch. Rejecting.');
        res.status(401).send('Invalid signature');
        return;
      }
    }
  } else {
    logger.warn('META_APP_SECRET not configured. Skipping webhook signature validation.');
  }

  const body = req.body;

  // Always respond 200 immediately so Meta doesn't retry
  res.status(200).send('EVENT_RECEIVED');

  if (body.object !== 'whatsapp_business_account') return;

  // ---- CHECK IF BOT IS ACTIVE ----
  if (!(await ConfigService.isBotActive())) {
    logger.info('Bot is deactivated — ignoring incoming message');
    return;
  }

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Handle incoming text messages
    const messages = value?.messages;
    if (messages && messages.length > 0) {
      const message = messages[0];
      const from = message.from;

      if (message.type === 'text' && message.text?.body) {
        let userText = message.text.body;
        if (userText.length > 2000) {
          logger.warn(`Truncating oversized message from ${from}`);
          userText = userText.substring(0, 2000);
        }
        logger.info(`WhatsApp from ${from}: "${userText}"`);

        const aiReply = await AIService.generateReply(from, userText);
        logger.info(`AI reply to ${from}: "${aiReply}"`);

        await MetaService.sendWhatsAppMessage(from, aiReply);
      }
    }

    // Handle status updates (delivered, read, etc.)
    const statuses = value?.statuses;
    if (statuses && statuses.length > 0) {
      const status = statuses[0];
      logger.info(`Message to ${status.recipient_id}: ${status.status}`);
    }
  } catch (error: any) {
    logger.error(`Error processing WhatsApp webhook: ${error.message}`);
  }
});

// ============================================================
// Contact Form Webhook (POST)
// ============================================================

/**
 * Normalize a phone number to WhatsApp-compatible format.
 * WhatsApp API requires: country code + number, no +, no spaces, no dashes.
 * e.g. "919876543210"
 */
function normalizePhone(raw: string): string {
  // Strip everything except digits
  let digits = raw.replace(/\D/g, '');

  // Remove leading 0 (common in Indian numbers like 09876543210)
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  // If it's a 10-digit number (no country code), prepend India code 91
  if (digits.length === 10) {
    digits = '91' + digits;
  }

  return digits;
}

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const contactFormSchema = z.object({
  name: z.string().optional(),
  phone: z.string().min(1, 'Phone number is required'),
  message: z.string().optional(),
});

router.post('/contact-form', contactLimiter, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.WEBHOOK_SECRET || await ConfigService.get('META_VERIFY_TOKEN');
  
  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = contactFormSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn('Contact form rejected — invalid payload');
    res.status(400).json({ error: parsed.error.format() });
    return;
  }

  const { name, phone, message } = parsed.data;

  logger.info(`Contact form received — Name: "${name}", Phone: "${phone}", Message: "${message}"`);

  // CHECK IF BOT IS ACTIVE
  if (!(await ConfigService.isBotActive())) {
    logger.info('Bot is deactivated — ignoring contact form trigger');
    res.status(200).json({ success: false, message: 'Bot is currently deactivated' });
    return;
  }

  // Normalize phone to WhatsApp format
  const normalizedPhone = normalizePhone(phone);
  logger.info(`Normalized phone: "${phone}" → "${normalizedPhone}"`);

  if (normalizedPhone.length < 10) {
    logger.warn(`Phone number too short after normalization: "${normalizedPhone}"`);
    res.status(400).json({ error: 'Invalid phone number' });
    return;
  }

  // Respond immediately so the form doesn't hang
  res.status(200).json({ success: true, message: 'Automation triggered' });

  try {
    const fixedMsg = "Thank you for contacting us! We have received your inquiry. Our team will get back to you shortly.";
    logger.info(`Sending fixed message to ${normalizedPhone}...`);
    const sent = await MetaService.sendWhatsAppMessage(normalizedPhone, fixedMsg);
    logger.info(`Fixed message ${sent ? 'SENT' : 'FAILED'}`);
  } catch (error: any) {
    logger.error(`Error processing contact form: ${error.message}`);
  }
});

export default router;
