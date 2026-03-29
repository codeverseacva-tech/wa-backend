import axios from 'axios';
import { config } from '@/config';
import { redis } from './redis';
import { logger } from './logger';
import { AppError } from './errors';

const TUMA_BASE_URL = 'https://api.tuma.co.ke';

class TumaClient {
  private axiosInstance: ReturnType<typeof axios.create>;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: TUMA_BASE_URL,
      timeout: 10000,
    });
  }

  private async getAccessToken(): Promise<string> {
    const cacheKey = 'tuma:access_token';
    const cachedToken = await redis.get(cacheKey);
    if (cachedToken) return cachedToken;

    try {
      const response = await axios.post<{ success: boolean; token: string; expires_in: number }>(
        `${TUMA_BASE_URL}/auth/token`,
        {
          email: config.tuma.email,
          api_key: config.tuma.apiKey,
        }
      );

      if (!response.data.success) {
        throw new Error('Tuma authentication failed');
      }

      const { token, expires_in } = response.data;
      
      // Cache with TTL - 60 seconds buffer
      await redis.set(cacheKey, token, 'EX', expires_in - 60);
      
      return token;
    } catch (error: any) {
      logger.error('❌ Tuma Auth Failed:', error.response?.data || error.message);
      throw new AppError('MPESA_AUTH_FAILED', 502, 'Failed to authenticate with Tuma API');
    }
  }

  async initiateStkPush(params: {
    phoneNumber: string;
    amount: number;
    description: string;
  }) {
    const { phoneNumber, amount, description } = params;
    const token = await this.getAccessToken();

    const payload = {
      amount: Math.ceil(amount),
      phone: phoneNumber,
      callback_url: config.tuma.callbackUrl,
      description: description,
    };

    try {
      const response = await this.axiosInstance.post<{
        success: boolean;
        message: string;
        data?: {
          merchant_request_id: string;
          checkout_request_id: string;
          customer_message: string;
        };
      }>(
        '/payment/stk-push',
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Tuma STK Push failed');
      }

      return response.data.data;
    } catch (error: any) {
      logger.error('❌ Tuma STK Push Failed:', error.response?.data || error.message);
      throw new AppError(
        'MPESA_STK_FAILED', 
        502, 
        error.response?.data?.message || 'Failed to initiate Tuma payment'
      );
    }
  }

  // Tuma doesn't specify a status query in the snippet, so we'll leave it as a placeholder
  // if we ever find one or need to mock it for the polling loop.
  async queryStkPushStatus(_checkoutRequestId: string) {
    throw new AppError('INTERNAL_ERROR', 501, 'Tuma status query not implemented (use webhooks)');
  }
}

export const tumaClient = new TumaClient();
