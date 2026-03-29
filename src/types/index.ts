export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
}

export interface WhatsappSession {
  id: string;
  status: 'active' | 'inactive' | 'loading';
  lastSeen?: string;
}
