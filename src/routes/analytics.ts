import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { supabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';

const router = Router();

router.use(authMiddleware);

/**
 * GET /v1/analytics/overview
 * messages table has no user_id — joins through whatsapp_sessions
 */
router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;

        // Active session count
        const { count: totalSessions, error: sessionsError } = await supabase
            .from('whatsapp_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'authenticated');

        if (sessionsError) throw new AppError('DATABASE_ERROR', 500, sessionsError.message);

        // Get session IDs to query messages
        const { data: userSessions, error: sessionIdsError } = await supabase
            .from('whatsapp_sessions')
            .select('id')
            .eq('user_id', userId);

        if (sessionIdsError) throw new AppError('DATABASE_ERROR', 500, sessionIdsError.message);

        const sessionIds = (userSessions ?? []).map((s: any) => s.id);

        let messagesSent = 0;
        if (sessionIds.length > 0) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const { count, error: messagesError } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .in('session_id', sessionIds)
                .gte('created_at', thirtyDaysAgo.toISOString());
            if (messagesError) throw new AppError('DATABASE_ERROR', 500, messagesError.message);
            messagesSent = count ?? 0;
        }

        // API calls from usage_stats current month
        let apiCalls = 0;
        const currentMonth = new Date().toISOString().slice(0, 7);
        const { data: usageData } = await supabase
            .from('usage_stats')
            .select('message_count')
            .eq('user_id', userId)
            .eq('month_year', currentMonth)
            .single();
        if (usageData) apiCalls = usageData.message_count ?? 0;

        return res.json({
            success: true,
            data: {
                total_sessions: totalSessions ?? 0,
                messages_sent: messagesSent,
                api_calls: apiCalls,
            },
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /v1/analytics/trends
 * Daily message counts for last 7 days
 */
router.get('/trends', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;

        const { data: userSessions, error: sessionIdsError } = await supabase
            .from('whatsapp_sessions')
            .select('id')
            .eq('user_id', userId);
        if (sessionIdsError) throw new AppError('DATABASE_ERROR', 500, sessionIdsError.message);

        const sessionIds = (userSessions ?? []).map((s: any) => s.id);

        // Pre-fill last 7 days
        const countsByDate = new Map<string, number>();
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            countsByDate.set(d.toISOString().split('T')[0], 0);
        }

        if (sessionIds.length > 0) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const { data, error } = await supabase
                .from('messages')
                .select('created_at')
                .in('session_id', sessionIds)
                .gte('created_at', sevenDaysAgo.toISOString())
                .order('created_at', { ascending: true });
            if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
            (data ?? []).forEach((row: any) => {
                const dateStr = row.created_at.split('T')[0];
                if (countsByDate.has(dateStr)) {
                    countsByDate.set(dateStr, (countsByDate.get(dateStr) ?? 0) + 1);
                }
            });
        }

        const trends = Array.from(countsByDate.entries()).map(([date, count]) => ({
            date,
            total_sent: count,
            metric_type: 'messages_sent',
        }));

        return res.json({ success: true, data: trends });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /v1/analytics/sessions
 * Session rows for the authenticated user
 */
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = parseInt(req.query.offset as string) || 0;

        const { data, error, count } = await supabase
            .from('whatsapp_sessions')
            .select('session_id, status, created_at', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw new AppError('DATABASE_ERROR', 500, error.message);

        return res.json({
            success: true,
            data: { data: data ?? [], total: count ?? 0, limit, offset },
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /v1/analytics/daily
 * Daily series for charts (last 7 days)
 */
router.get('/daily', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;

        const { data: userSessions, error: sessionIdsError } = await supabase
            .from('whatsapp_sessions')
            .select('id')
            .eq('user_id', userId);
        if (sessionIdsError) throw new AppError('DATABASE_ERROR', 500, sessionIdsError.message);

        const sessionIds = (userSessions ?? []).map((s: any) => s.id);

        const countsByDate = new Map<string, number>();
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            countsByDate.set(d.toISOString().split('T')[0], 0);
        }

        if (sessionIds.length > 0) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const { data, error } = await supabase
                .from('messages')
                .select('created_at')
                .in('session_id', sessionIds)
                .gte('created_at', sevenDaysAgo.toISOString());
            if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
            (data ?? []).forEach((row: any) => {
                const dateStr = row.created_at.split('T')[0];
                if (countsByDate.has(dateStr)) {
                    countsByDate.set(dateStr, (countsByDate.get(dateStr) ?? 0) + 1);
                }
            });
        }

        const daily = Array.from(countsByDate.entries()).map(([date, count]) => ({
            name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
            sent: count,
            api: 0,
        }));

        return res.json({ success: true, data: daily });
    } catch (err) {
        next(err);
    }
});

export default router;