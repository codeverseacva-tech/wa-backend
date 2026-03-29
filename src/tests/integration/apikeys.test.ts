import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import axios from 'axios';
import { BASE_URL, signIn, authHeaders, idempotencyHeaders, cleanupTestData, supabase } from './setup';

describe('API keys', () => {
  let token: string;
  let testUserId: string;

  beforeAll(async () => {
    token = await signIn();
    const { data: { user } } = await supabase.auth.getUser(token);
    testUserId = user!.id;
  });

  afterEach(async () => {
    await cleanupTestData('api_keys', 'user_id', testUserId);
  });

  test('POST /v1/api-keys — creates key returns key_raw once', async () => {
    const response = await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'test-key',
      permissions: ['messages:send'],
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    
    expect(response.status).toBe(201);
    expect(response.data.data.key_raw).toBeTypeOf('string');
    expect(response.data.data.key_prefix).toBeTypeOf('string');
    expect(response.data.data.key_prefix.length).toBe(8);
  });

  test('GET /v1/api-keys — does not return key_raw', async () => {
    // 1. Create a key first
    await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'test-key',
      permissions: ['messages:send'],
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });

    // 2. GET API keys list
    const response = await axios.get<any>(`${BASE_URL}/v1/api-keys`, {
      headers: authHeaders(token),
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.data.every((k: any) => k.key_raw === undefined)).toBe(true);
    expect(response.data.data.every((k: any) => k.key_prefix !== undefined)).toBe(true);
  });

  test('Request with valid X-API-Key passes auth', async () => {
    // 1. Create an API key with scope 'messages:read'
    const createResp = await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'read-messages',
      permissions: ['messages:read'],
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const apiKey = createResp.data.data.key_raw;

    // 2. Make GET /v1/messages?session_id=fake with X-API-Key header
    // We expect it not to be 401/403 (e.g. 404 is fine as session doesn't exist)
    try {
      await axios.get<any>(`${BASE_URL}/v1/messages?session_id=not-exists`, {
        headers: { 'X-API-Key': apiKey },
      });
    } catch (error: any) {
      expect(error.response.status).not.toBe(401);
      expect(error.response.status).not.toBe(403);
    }
  });

  test('Expired key returns 401', async () => {
    // 1. Create key with expires_at = 1 second from now
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    const createResp = await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'expired-key',
      permissions: ['messages:read'],
      expires_at: expiresAt,
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const apiKey = createResp.data.data.key_raw;

    // 2. Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 3. Make request
    try {
      await axios.get<any>(`${BASE_URL}/v1/api-keys`, {
        headers: { 'X-API-Key': apiKey },
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(401);
      expect(error.response.data.error.code).toBe('API_KEY_EXPIRED');
    }
  });

  test('Wrong scope returns 403', async () => {
    // 1. Create key with permissions: ['sessions:read'] only
    const createResp = await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'read-only',
      permissions: ['sessions:read'],
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const apiKey = createResp.data.data.key_raw;

    // 2. Make POST /v1/sessions with that key (requires sessions:manage)
    try {
      await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: 'denied' }, {
        headers: { 'X-API-Key': apiKey },
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(403);
      expect(error.response.data.error.code).toBe('API_KEY_INSUFFICIENT_SCOPE');
    }
  });

  test('Non-whitelisted IP returns 403', async () => {
    // 1. Create key with non-routable ip_whitelist
    const createResp = await axios.post<any>(`${BASE_URL}/v1/api-keys`, {
      key_name: 'ip-blocked',
      permissions: ['sessions:read'],
      ip_whitelist: ['192.0.2.0/24'],
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const apiKey = createResp.data.data.key_raw;

    // 2. Make request
    try {
      await axios.get<any>(`${BASE_URL}/v1/sessions`, {
        headers: { 'X-API-Key': apiKey },
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(403);
      expect(error.response.data.error.code).toBe('API_KEY_IP_BLOCKED');
    }
  });
});
