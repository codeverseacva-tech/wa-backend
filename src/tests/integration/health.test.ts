import { describe, test, expect } from 'vitest';
import axios from 'axios';
import { execSync } from 'node:child_process';
import { BASE_URL, sleep } from './setup';

describe('Health endpoints', () => {
  test('GET /health/live returns 200', async () => {
    const response = await axios.get<any>(`${BASE_URL}/health/live`);
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ status: 'ok' });
  });

  test('GET /health/ready returns 200 with all checks passing', async () => {
    const response = await axios.get<any>(`${BASE_URL}/health/ready`);
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('ok');
    expect(response.data.checks).toEqual({
      redis: 'ok',
      supabase: 'ok',
    });
  });

  const shouldSkipDestructive = process.env.SKIP_DESTRUCTIVE_TESTS === 'true';

  test.skipIf(shouldSkipDestructive)('GET /health/ready reflects Redis degraded state', async () => {
    try {
      // 1. Stop the Redis container
      console.log('Stopping Redis container to test degradation...');
      execSync('docker compose -f docker-compose.local.yml stop redis');
      
      // 2. Poll /health/ready until it returns 503
      let isDegraded = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        try {
          const response = await axios.get<any>(`${BASE_URL}/health/ready`);
          if (response.status === 200) {
            await sleep(1000);
          }
        } catch (error: any) {
          if (error.response?.status === 503 || error.response?.data?.status === 'degraded') {
            expect(error.response.data.status).toBe('degraded');
            expect(error.response.data.checks.redis).toBe('error');
            isDegraded = true;
            break;
          }
          await sleep(1000);
        }
      }
      expect(isDegraded).toBe(true);

    } finally {
      // 3. Restart the Redis container
      console.log('Restarting Redis container...');
      execSync('docker compose -f docker-compose.local.yml start redis');

      // 4. Poll until it recovers
      let isRecovered = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 30000) {
        try {
          const response = await axios.get<any>(`${BASE_URL}/health/ready`);
          if (response.status === 200 && response.data.status === 'ok') {
            isRecovered = true;
            break;
          }
        } catch (error) {
          // Ignore
        }
        await sleep(1000);
      }
      expect(isRecovered).toBe(true);
    }
  });
});
