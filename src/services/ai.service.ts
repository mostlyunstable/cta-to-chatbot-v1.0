import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DBService } from './db.service';
import { ConfigService } from './config.service';

export class AIService {
  /**
   * Generate an AI reply for a WhatsApp user message.
   * Reads API key and system prompt from ConfigService (live-updatable from admin panel).
   */
  static async generateReply(userId: string, userMessage: string): Promise<string> {
    const apiKey = await ConfigService.get('GEMINI_API_KEY');

    if (!apiKey || apiKey === 'your_gemini_api_key') {
      logger.error('❌ Gemini API key is missing or not set');
      return 'Thanks for your message! Our team will get back to you shortly.';
    }

    try {
      // 1. Fetch conversation history FIRST (before saving new message)
      const history = await DBService.getHistory(userId, 10);

      // 2. Save incoming message to DB
      await DBService.saveMessage(userId, 'user', userMessage);

      // 3. Create model with LIVE system prompt from admin panel
      const genAI = new GoogleGenerativeAI(apiKey);
      const systemPrompt = await ConfigService.get('SYSTEM_PROMPT');

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: systemPrompt || undefined,
      });

      // 4. Start chat with history context
      const chat = model.startChat({ history: history as any });

      // 5. Send user message and get response
      const result = await chat.sendMessage(userMessage);
      const aiResponse = result.response.text();

      // 6. Save AI response to DB
      await DBService.saveMessage(userId, 'model', aiResponse);

      return aiResponse;
    } catch (error: any) {
      logger.error('❌ AI generation error:', error.message);
      return 'Thanks for your message! Our team will get back to you shortly.';
    }
  }
}
