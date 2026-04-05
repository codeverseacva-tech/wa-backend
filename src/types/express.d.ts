declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: {
        id: string;
        email?: string;
        role: string;
        plan?: string;
        rateLimit?: number;
        apiKeyId?: string;
        partnerId?: string;
        subUserId?: string;
        permissions?: string[];
      };
      apiKey?: {
        id: string;
        userId: string;
        permissions: string[];
        rateLimit?: number;
        partnerId?: string;
        subUserId?: string;
      };
    }
  }
}

export { };
