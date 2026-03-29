export type ErrorCode = 
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'DATABASE_ERROR'
  | 'ALREADY_EXISTS'
  | 'INVALID_PLAN'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_TOKEN'
  | 'API_KEY_EXPIRED'
  | 'API_KEY_IP_BLOCKED'
  | 'API_KEY_INSUFFICIENT_SCOPE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'CORS_ORIGIN_NOT_ALLOWED'
  | 'SESSION_ALREADY_EXISTS'
  | 'SESSION_NOT_AUTHENTICATED'
  | 'SESSION_QR_EXPIRED'
  | 'SESSION_PAIRING_FAILED'
  | 'SESSION_LIMIT_EXCEEDED'
  | 'MESSAGE_SEND_FAILED'
  | 'INVALID_JID'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_ALREADY_RUNNING'
  | 'SCHEDULED_MESSAGE_EXPIRED'
  | 'WEBHOOK_DELIVERY_FAILED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'MPESA_AUTH_FAILED'
  | 'MPESA_STK_FAILED'
  | 'MPESA_PAYMENT_PENDING'
  | 'MPESA_PAYMENT_FAILED'
  | 'INVALID_PHONE_NUMBER';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number = 500,
    message?: string,
    public readonly payload?: any
  ) {
    super(message || code);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthError extends AppError {
  constructor(code: ErrorCode = 'UNAUTHORIZED', status: number = 401, message?: string) {
    super(code, status, message);
    this.name = 'AuthError';
  }
}
