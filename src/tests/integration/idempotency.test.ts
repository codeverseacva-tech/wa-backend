import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BASE_URL, signIn, authHeaders, cleanupTestData, supabase } from './setup';

describe('Idempotency', () => {
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

  test('Same Idempotency-Key twice returns identical response', async () => {
    const key = uuidv4();
    const name = `idem-test-${uuidv4().slice(0, 8)}`;
    const headers = { ...authHeaders(token), 'Idempotency-Key': key };

    // 1. POST first time
    const response1 = await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, { headers });
    const sessionId1 = response1.data.data.session_id;

    // 2. POST second time with SAME key and SAME body
    const response2 = await axios.post<any>(`${BASE_URL}/v1/sessions`, { name }, { headers });
    const sessionId2 = response2.data.data.session_id;

    // 3. Assert both responses are identical (same session_id)
    expect(sessionId1).toBe(sessionId2);
    expect(response2.status).toBe(201);

    // 4. Query DB directly via Supabase service role: assert only ONE session row was created
    const { data: sessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('name', name)
      .eq('user_id', testUserId);
    
    expect(error).toBeNull();
    expect(sessions!.length).toBe(1);
  });

  test('Same key different body returns 422', async () => {
    const key = uuidv4();
    const headers = { ...authHeaders(token), 'Idempotency-Key': key };

    // 1. POST with body A
    await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: 'first-name' }, { headers });

    try {
      // 2. POST with same key but body B
      await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: 'different-name' }, { headers });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(422);
      expect(error.response.data.error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    }
  });

  test('Missing Idempotency-Key returns 400', async () => {
    try {
      await axios.post<any>(`${BASE_URL}/v1/sessions`, { name: 'missing-key' }, {
        headers: authHeaders(token),
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    }
  });
});
