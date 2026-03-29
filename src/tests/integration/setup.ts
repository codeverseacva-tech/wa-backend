import { expect, beforeAll } from 'vitest';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';

// Load env vars if they aren't available via vitest's global env
const BASE_URL = process.env.TEST_API_BASE_URL 
  ?? process.env.API_BASE_URL 
  ?? 'http://localhost:3000';
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'test@zaplink.dev';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'Test1234!';
const TEST_USER_B_EMAIL = process.env.TEST_USER_B_EMAIL ?? 'testb@zaplink.dev';
const TEST_USER_B_PASSWORD = process.env.TEST_USER_B_PASSWORD ?? 'Test1234!';

// Supabase config for test data cleanup
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Signs in a test user and returns the JWT access token.
 */
export async function signIn(email = TEST_USER_EMAIL, password = TEST_USER_PASSWORD) {
  try {
    const response = await axios.post(`${BASE_URL}/v1/auth/signin`, {
      email,
      password,
    });
    return (response.data as any).data.access_token;
  } catch (error: any) {
    throw new Error(`signIn failed for ${email}: ${error.response?.data?.error?.code || error.message}`);
  }
}

/**
 * Returns the Authorization header object for a token.
 */
export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Returns the Idempotency-Key header object.
 */
export function idempotencyHeaders() {
  return {
    'Idempotency-Key': uuidv4(),
  };
}

/**
 * Helper to delete test rows from any table using the service role key.
 */
export async function cleanupTestData(table: string, field: string, value: any) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq(field, value);
  
  if (error) {
    console.error(`Failed to cleanup test data from table ${table}:`, error.message);
  }
}

/**
 * Sleep for a given amount of time.
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Verify that the API is reachable before starting any tests
beforeAll(async () => {
  try {
    const response = await axios.get(`${BASE_URL}/health/live`);
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error: any) {
    throw new Error(
      `API not reachable at ${BASE_URL} — is Docker running?\n` +
      `Actual error: ${error?.message ?? JSON.stringify(error)}\n` +
      `Code: ${error?.code ?? 'unknown'}`
    )
  }
});

export { BASE_URL, TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD, supabase };
