import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { ProfilesRepository, PlansRepository } from '@/repositories';
import { AppError } from '@/lib/errors';
import { quotaSyncQueue } from '@/lib/queues';
import { logger } from '@/lib/logger';

const profilesRepo = new ProfilesRepository();
const plansRepo = new PlansRepository();

export class PlanQuotaService {
  private getMonthYear(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Fetch plan + usage. Throw QUOTA_EXCEEDED if over.
   * Cache quota check in Redis (TTL 60s).
   */
  public async checkMessageQuota(userId: string) {
    const month = this.getMonthYear();
    const redisKey = `quota:${userId}:messages:${month}`;
    const cacheKey = `cache:quota_check:${userId}:messages`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.exceeded) {
        throw new AppError('QUOTA_EXCEEDED', 403, 'Monthly message quota exceeded', data.info);
      }
      return data.info;
    }

    // Fetch current usage from Redis
    const usedRaw = await redis.get(redisKey);
    const usedCount = usedRaw ? parseInt(usedRaw) : 0;

    const profile = await profilesRepo.findById(userId);
    const plan = await plansRepo.findById(profile.plan_id);

    const isExceeded = plan.message_quota !== -1 && usedCount >= plan.message_quota;
    const info = { used: usedCount, limit: plan.message_quota };

    // Cache the result for 60s
    await redis.set(cacheKey, JSON.stringify({ exceeded: isExceeded, info }), 'EX', 60);

    if (isExceeded) {
      throw new AppError('QUOTA_EXCEEDED', 403, 'Monthly message quota exceeded', info);
    }

    return info;
  }

  public async checkSessionLimit(userId: string) {
    const profile = await profilesRepo.findById(userId);
    const plan = await plansRepo.findById(profile.plan_id);

    const { count, error } = await supabase
      .from('whatsapp_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'connected');

    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);

    const sessionCount = count || 0;
    if (plan.session_limit !== -1 && sessionCount >= plan.session_limit) {
      logger.warn({ userId, sessionCount, limit: plan.session_limit }, '🚀 Session limit reached for user');
      throw new AppError('SESSION_LIMIT_EXCEEDED', 403, 'Active session limit exceeded', {
        used: sessionCount,
        limit: plan.session_limit,
      });
    }

    return { used: sessionCount, limit: plan.session_limit };
  }

  /**
   * Redis INCR on key quota:{userId}:messages:{month}.
   */
  public async incrementMessageCount(userId: string) {
    const month = this.getMonthYear();
    const key = `quota:${userId}:messages:${month}`;
    const newVal = await redis.incr(key);

    // Schedule sync job (idempotent job definition via jobId)
    const jobId = `sync:${userId}:${month}`;
    await quotaSyncQueue.add(
      'sync-usage',
      { userId, month },
      { 
        jobId, // Ensures only one job per user/month exists in the queue at a time
        delay: 5 * 60 * 1000, // 5 minutes delay
        removeOnComplete: true,
      }
    );

    return newVal;
  }
}

export const planQuotaService = new PlanQuotaService();
