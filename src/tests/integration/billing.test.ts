import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import axios from 'axios';
import { BASE_URL, signIn, authHeaders, idempotencyHeaders, cleanupTestData, supabase } from './setup';

describe('Billing — M-Pesa Daraja sandbox', () => {
  let token: string;
  let testUserId: string;

  beforeAll(async () => {
    // Skip entire suite if MPESA_ENV !== 'sandbox' to prevent accidental production charges
    if (process.env.MPESA_ENV !== 'sandbox') {
      console.log('Skipping M-Pesa billing tests: MPESA_ENV is not sandbox');
      return;
    }
    
    token = await signIn();
    const { data: { user } } = await supabase.auth.getUser(token);
    testUserId = user!.id;
  });

  afterEach(async () => {
    await cleanupTestData('invoices', 'user_id', testUserId);
  });

  test('POST /v1/billing/stk-push — valid Kenyan phone initiates payment', async () => {
    if (process.env.MPESA_ENV !== 'sandbox') return;

    const response = await axios.post<any>(`${BASE_URL}/v1/billing/stk-push`, {
      plan_id: 'starter',
      billing_cycle: 'monthly',
      phone: '254712345678',
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    
    expect(response.status).toBe(201);
    expect(response.data.success).toBe(true);
    expect(response.data.data.payment_id).toBeDefined();
    expect(response.data.data.message).toBeDefined();
  });

  test('POST /v1/billing/stk-push — invalid phone returns 422', async () => {
    if (process.env.MPESA_ENV !== 'sandbox') return;

    try {
      await axios.post<any>(`${BASE_URL}/v1/billing/stk-push`, {
        plan_id: 'starter',
        billing_cycle: 'monthly',
        phone: '07123',
      }, {
        headers: authHeaders(token),
      });
      throw new Error('Should have failed');
    } catch (error: any) {
      expect(error.response.status).toBe(422);
      expect(error.response.data.error.code).toBe('INVALID_PHONE_NUMBER');
    }
  });

  test('GET /v1/billing/payment/:id/status — returns pending initially', async () => {
    if (process.env.MPESA_ENV !== 'sandbox') return;

    // 1. Initiate push
    const pushResp = await axios.post<any>(`${BASE_URL}/v1/billing/stk-push`, {
      plan_id: 'trial',
      billing_cycle: 'monthly',
      phone: '254712345678',
    }, {
      headers: { ...authHeaders(token), ...idempotencyHeaders() },
    });
    const paymentId = pushResp.data.data.payment_id;

    // 2. GET status
    const statusResp = await axios.get<any>(`${BASE_URL}/v1/billing/payment/${paymentId}/status`, {
      headers: authHeaders(token),
    });
    
    expect(statusResp.status).toBe(200);
    expect(statusResp.data.data.status).toBe('pending');
  });

  test('Duplicate STK push same Idempotency-Key returns cached response', async () => {
    if (process.env.MPESA_ENV !== 'sandbox') return;

    const key = `push-key-${Date.now()}`;
    const headers = { ...authHeaders(token), 'Idempotency-Key': key };
    const body = {
      plan_id: 'starter',
      billing_cycle: 'monthly',
      phone: '254712345678',
    };

    // 1. POST first push
    const resp1 = await axios.post<any>(`${BASE_URL}/v1/billing/stk-push`, body, { headers });
    const paymentId1 = resp1.data.data.payment_id;

    // 2. POST second push with SAME key
    const resp2 = await axios.post<any>(`${BASE_URL}/v1/billing/stk-push`, body, { headers });
    const paymentId2 = resp2.data.data.payment_id;

    // 3. Assert they're the same
    expect(paymentId1).toBe(paymentId2);
    expect(resp2.status).toBe(201);
  });
});
