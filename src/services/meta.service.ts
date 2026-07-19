import { logger } from '../utils/logger';
import axios from 'axios';
import { ConfigService } from './config.service';

export class MetaService {
  /**
   * Send a text message via WhatsApp Cloud API.
   * Reads credentials from ConfigService (live-updatable from admin panel).
   */
  static async sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
    const accessToken = await ConfigService.get('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = await ConfigService.get('WHATSAPP_PHONE_NUMBER_ID');

    if (!accessToken || accessToken === 'your_whatsapp_access_token') {
      logger.error('⚠️  WhatsApp Access Token not configured');
      return false;
    }
    if (!phoneNumberId || phoneNumberId === 'your_whatsapp_phone_number_id') {
      logger.error('⚠️  WhatsApp Phone Number ID not configured');
      return false;
    }

    try {
      const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

      await axios.post(url, {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`✅ WhatsApp message sent to ${to}`);
      return true;
    } catch (error: any) {
      logger.error('❌ WhatsApp send failed:', error.response?.data || error.message);
      return false;
    }
  }

  static async sendWhatsAppTemplate(to: string, templateName: string, customerName: string): Promise<boolean> {
    const accessToken = await ConfigService.get('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = await ConfigService.get('WHATSAPP_PHONE_NUMBER_ID');

    if (!accessToken || accessToken === 'your_whatsapp_access_token') {
      logger.error('⚠️  WhatsApp Access Token not configured');
      return false;
    }
    if (!phoneNumberId || phoneNumberId === 'your_whatsapp_phone_number_id') {
      logger.error('⚠️  WhatsApp Phone Number ID not configured');
      return false;
    }

    try {
      const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

      await axios.post(url, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: customerName || 'Customer'
                }
              ]
            }
          ]
        }
      }, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`✅ Contact form template message sent`);
      return true;
    } catch (error: any) {
      logger.error('❌ WhatsApp template send failed:', error.response?.data || error.message);
      return false;
    }
  }
}
