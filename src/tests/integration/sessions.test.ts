import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BASE_URL, TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD, signIn, authHeaders, idempotencyHeaders, cleanupTestData, supabase } from './setup';

describe('WhatsApp sessions', () => {
  let token: string;
  let testUserId: string;

  beforeAll(async () => {
    token = await signIn();
    const { data: { user } } = await supabase.auth.getUser(token);
    testUserId = user!.id;
  });

  afterEach(async () => {
    await cleanupTestData('whatsapp_sessions', 'user_id', testUserId);
  });

  test('POST /v1/sessions — creates session returns session_id', async () => {
    const name = `test-session-${uuidv4().slice(0, 8)}`;
    const response = await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    
    expect(response.status).toBe(201);
    expect(response.data.success).toBe(true);
    expect(response.data.data.session_id).toBeDefined();
    expect(response.data.data.status).toBe('scanning');
  });

  test('GET /v1/sessions — returns only current user sessions', async () => {
    // 1. Create a session as User A
    const nameA = `session-user-a-${uuidv4().slice(0, 8)}`;
    await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: nameA }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });

    // 2. Sign in as User B
    const tokenB = await signIn(TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD);
    
    // 3. GET /v1/sessions as User B
    const responseB = await axios.get<any>(`${BASE_URL}/v1/sessions`, {
      headers: authHeaders(tokenB),
    });

    // 4. Assert User A's session is not in the list for User B
    const userAList = responseB.data.data.filter((s: any) => s.name === nameA);
    expect(userAList.length).toBe(0);
    
    // Clean up User A's session in afterEach
  });

  test('DELETE /v1/sessions/:id — removes session', async () => {
    const name = `delete-me-${uuidv4().slice(0, 8)}`;
    const createResp = await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const sessionId = createResp.data.data.session_id;

    const deleteResp = await axios.delete<any>(`${BASE_URL}/v1/sessions/${sessionId}`, {
      headers: authHeaders(token),
    });
    expect(deleteResp.status).toBe(200);

    const checkResp = await axios.get<any>(`${BASE_URL}/v1/sessions`, {
      headers: authHeaders(token),
    });
    const found = checkResp.data.data.find((s: any) => s.session_id === sessionId);
    expect(found).toBeUndefined();
  });

  test('POST /v1/sessions — duplicate name returns 409', async () => {
    const name = 'duplicate-test';
    
    // 1. Create first session
    await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });

    try {
      // 2. Try second session with same name
      await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, {
        headers: { ...authHeaders(token), ...idempotencyHeaders() },
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(409);
      expect(error.response.data.error.code).toBe('SESSION_ALREADY_EXISTS');
    }
  });

  test('POST /v1/sessions — beyond plan limit returns 429', async () => {
    // Note: trial plan allows 1 session in seed data.
    // If the test user already has 1 session, the next one should fail.
    
    // Create first session to ensure we reach the limit
    const name1 = `limit-test-1-${uuidv4().slice(0, 8)}`;
    await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: name1 }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    }).catch(() => {}); // might already be at limit

    try {
      // Try second session (should fail)
      const name2 = `limit-test-2-${uuidv4().slice(0, 8)}`;
      await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: name2 }, {
        headers: { ...authHeaders(token), ...idempotencyHeaders() },
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(429);
      expect(error.response.data.error.code).toBe('SESSION_LIMIT_EXCEEDED');
      expect(error.response.data.error.payload).toHaveProperty('current');
      expect(error.response.data.error.payload).toHaveProperty('limit');
    }
  });
});
