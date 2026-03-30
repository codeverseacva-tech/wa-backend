import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';

const router = Router();
export default router;

/* ─── TEMPLATES ─────────────────────────────────────────────── */
router.get('/templates/library', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});

/* ─── WEBHOOKS ───────────────────────────────────────────────── */
router.get('/webhooks', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.post('/webhooks', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { id: 'wh-1', ...req.body, created_at: new Date().toISOString() } });
});
router.delete('/webhooks/:id', authMiddleware, (req, res) => {
    res.json({ success: true, data: null });
});
router.post('/webhooks/:id/test', authMiddleware, (req, res) => {
    res.json({ success: true, data: { delivered: true } });
});
router.get('/webhooks/logs', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});

/* ─── GROUPS ─────────────────────────────────────────────────── */
router.get('/groups', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.post('/groups', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { group_jid: 'group-1', ...req.body } });
});
router.delete('/groups/:jid', authMiddleware, (req, res) => {
    res.json({ success: true, data: null });
});
router.post('/groups/:jid/participants', authMiddleware, (req, res) => {
    res.json({ success: true, data: { added: [] } });
});
router.get('/groups/:jid/invite', authMiddleware, (req, res) => {
    res.json({ success: true, data: { invite_link: 'https://chat.whatsapp.com/stub' } });
});

/* ─── NEWSLETTERS ────────────────────────────────────────────── */
router.get('/newsletters', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.post('/newsletters', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { newsletter_jid: 'nl-1', ...req.body } });
});
router.post('/newsletters/:jid/follow', authMiddleware, (req, res) => {
    res.json({ success: true, data: { following: true } });
});
router.post('/newsletters/:jid/unfollow', authMiddleware, (req, res) => {
    res.json({ success: true, data: { following: false } });
});
router.post('/newsletters/:jid/messages', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { sent: true } });
});

/* ─── SESSION EXTRAS ─────────────────────────────────────────── */
router.get('/sessions/:id/messages', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.post('/sessions/:id/messages', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { sent: true } });
});
router.delete('/sessions/:id', authMiddleware, (req, res) => {
    res.json({ success: true, data: null });
});
router.delete('/sessions/:id/chats/:chatId', authMiddleware, (req, res) => {
    res.json({ success: true, data: null });
});
router.post('/sessions/:id/pairing-code', authMiddleware, (req, res) => {
    res.json({ success: true, data: { code: '12345678' } });
});

/* ─── BULK CAMPAIGNS ─────────────────────────────────────────── */
router.get('/bulk/campaigns', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.post('/bulk/campaigns', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { id: 'campaign-1', ...req.body } });
});
router.post('/bulk/campaigns/:id/start', authMiddleware, (req, res) => {
    res.json({ success: true, data: { started: true } });
});

/* ─── SCHEDULER ──────────────────────────────────────────────── */
router.post('/scheduler/messages', authMiddleware, (req, res) => {
    res.status(201).json({ success: true, data: { id: 'sched-1', ...req.body } });
});
router.get('/scheduler/messages', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});

/* ─── VALIDATION ─────────────────────────────────────────────── */
router.post('/validation/numbers', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
});
router.get('/validation/profile-picture', authMiddleware, (req, res) => {
    res.json({ success: true, data: { url: null } });
});

/* ─── ADMIN ──────────────────────────────────────────────────── */
router.post('/admin/auth/signin', (req, res) => {
    res.json({ success: true, data: { token: 'admin-stub-token' } });
});
router.get('/admin/auth/me', authMiddleware, (req, res) => {
    res.json({ success: true, data: { id: 'admin-1', email: 'admin@zaplink.co.ke', role: 'super_admin' } });
});

/* ─── BILLING OVERVIEW ───────────────────────────────────────── */
router.get('/billing/overview', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: {
            plan: 'trial',
            sessionsUsed: 0,
            sessionsLimit: 1,
            messagesThisMonth: 0,
            nextBillingDate: null,
        }
    });
});