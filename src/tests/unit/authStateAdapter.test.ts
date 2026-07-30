import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBaileysAuthState } from '@/lib/baileys/authStateAdapter';
import { supabase } from '@/lib/supabase';

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    upsert: vi.fn(),
  }
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('useBaileysAuthState', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };
    vi.clearAllMocks();
  });

  it('handles Baileys 7 new key types without code changes (lid-mapping, device-list, tctoken)', async () => {
    const { state } = await useBaileysAuthState('test-session', mockRedis as any);
    
    // Test set
    await state.keys.set({
      'lid-mapping': { '123': { some: 'lid-data' } },
      'device-list': { '456': { some: 'device-data' } },
      'tctoken': { '789': { some: 'tctoken-data' } },
    } as any);

    expect(mockRedis.set).toHaveBeenCalledTimes(3);
    
    // The keys are serialized with BufferJSON.replacer
    expect(mockRedis.set).toHaveBeenCalledWith(
      'session:test-session:keys:lid-mapping:123',
      JSON.stringify({ some: 'lid-data' })
    );

    // Test get
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({ some: 'lid-data' }));
    const result = await state.keys.get('lid-mapping', ['123']);
    
    expect(mockRedis.get).toHaveBeenCalledWith('session:test-session:keys:lid-mapping:123');
    expect(result['123']).toEqual({ some: 'lid-data' });
  });

  it('does not crash when Supabase persistence fails during saveCreds', async () => {
    // Mock Supabase to fail with an error object
    (supabase.from as any)().upsert.mockResolvedValueOnce({ error: new Error('DB Connection Refused') });

    const { saveCreds } = await useBaileysAuthState('test-session', mockRedis as any);
    
    // This should NOT throw an error
    await expect(saveCreds()).resolves.not.toThrow();

    // Verify Redis was still updated
    expect(mockRedis.set).toHaveBeenCalledWith(
      'session:test-session:creds',
      expect.any(String)
    );
  });
  
  it('does not crash when Supabase throws an exception during saveCreds', async () => {
    // Mock Supabase to throw a rejected promise
    (supabase.from as any)().upsert.mockRejectedValueOnce(new Error('Network timeout'));

    const { saveCreds } = await useBaileysAuthState('test-session', mockRedis as any);
    
    // This should NOT throw an error
    await expect(saveCreds()).resolves.not.toThrow();

    // Verify Redis was still updated
    expect(mockRedis.set).toHaveBeenCalledWith(
      'session:test-session:creds',
      expect.any(String)
    );
  });
});
