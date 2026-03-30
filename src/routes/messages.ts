import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { messageService, SendMessagePayload } from '@/services/message.service';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { config } from '@/config';
import { randomUUID } from 'crypto';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/3gpp', 'video/quicktime',
            'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/aac',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'application/zip',
            'application/octet-stream',
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    },
});

const supabaseAdmin = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey
);

/**
 * POST /v1/sessions/:sessionId/upload
 * Upload media to Supabase Storage — returns public URL for Baileys.
 */
router.post('/:sessionId/upload', authMiddleware, upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            throw new AppError('VALIDATION_ERROR', 400, 'No file uploaded. Field name must be "file".');
        }

        const { originalname, mimetype, buffer } = req.file;
        const ext = originalname.split('.').pop();
        const filename = `${req.user!.id}/${req.params.sessionId}/${randomUUID()}.${ext}`;

        const { error } = await supabaseAdmin.storage
            .from('media')
            .upload(filename, buffer, { contentType: mimetype, upsert: false });

        if (error) throw new AppError('UPLOAD_FAILED', 500, error.message);

        const { data: { publicUrl } } = supabaseAdmin.storage
            .from('media')
            .getPublicUrl(filename);

        let type = 'document';
        if (mimetype.startsWith('image/')) type = 'image';
        else if (mimetype.startsWith('video/')) type = 'video';
        else if (mimetype.startsWith('audio/')) type = 'audio';

        logger.info(
            { sessionId: req.params.sessionId, filename, mimetype, size: buffer.length },
            '📎 Media uploaded to Supabase Storage'
        );

        res.json({
            success: true,
            data: { url: publicUrl, type, filename: originalname, mimetype, size: buffer.length }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Transforms frontend Baileys-native format into MessageService payload.
 */
function normalizePayload(to: string, message: Record<string, any>): SendMessagePayload {
    if (typeof message === 'string') return { to, type: 'text', text: message };
    if (message.text) return { to, type: 'text', text: message.text };

    if (message.image) {
        const img = typeof message.image === 'object' ? message.image : {};
        return { to, type: 'image', url: img.url, base64: img.base64, mimetype: img.mimetype || 'image/jpeg', caption: img.caption || message.caption };
    }

    if (message.video) {
        const vid = typeof message.video === 'object' ? message.video : {};
        return { to, type: 'video', url: vid.url, base64: vid.base64, mimetype: vid.mimetype || 'video/mp4', caption: vid.caption || message.caption, gif: vid.gifPlayback ?? false };
    }

    if (message.audio) {
        const aud = typeof message.audio === 'object' ? message.audio : {};
        return { to, type: 'audio', url: aud.url, base64: aud.base64, mimetype: aud.mimetype || 'audio/mpeg', ptt: aud.ptt ?? false };
    }

    if (message.document) {
        const doc = typeof message.document === 'object' ? message.document : {};
        return { to, type: 'document', url: doc.url, base64: doc.base64, mimetype: doc.mimetype || 'application/octet-stream', filename: doc.fileName || doc.filename || 'file', caption: doc.caption || message.caption };
    }

    if (message.sticker) {
        const stk = typeof message.sticker === 'object' ? message.sticker : {};
        return { to, type: 'sticker', url: stk.url, base64: stk.base64 };
    }

    if (message.location) {
        const loc = message.location;
        return { to, type: 'location', latitude: loc.degreesLatitude ?? loc.latitude, longitude: loc.degreesLongitude ?? loc.longitude, location_name: loc.name, location_address: loc.address };
    }

    if (message.contacts || message.contact) {
        const c = message.contacts || message.contact;
        return { to, type: 'contact', contact_name: c.displayName || c.contact_name, contact_phone: c.contact_phone };
    }

    if (message.react) {
        return { to, type: 'reaction', reaction_emoji: message.react.text, reaction_message_id: message.react.key?.id, reaction_from_me: message.react.key?.fromMe ?? false };
    }

    if (message.type) return { to, ...message } as SendMessagePayload;

    throw new AppError('VALIDATION_ERROR', 400, 'Unrecognized message format.');
}

/**
 * POST /v1/sessions/:sessionId/messages
 * Send a message via an active WhatsApp session.
 */
router.post('/:sessionId/messages', authMiddleware, async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { to, message } = req.body;
        if (!to) throw new AppError('VALIDATION_ERROR', 400, 'to is required');
        if (!message) throw new AppError('VALIDATION_ERROR', 400, 'message is required');
        const payload = normalizePayload(to, message);
        const result = await messageService.send(sessionId, payload);
        res.status(201).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /v1/sessions/:sessionId/messages
 * List messages for a session.
 */
router.get('/:sessionId/messages', authMiddleware, async (req, res, next) => {
    try {
        res.json({ success: true, data: [] });
    } catch (err) {
        next(err);
    }
});

export default router;