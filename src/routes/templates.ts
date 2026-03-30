import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * GET /templates/library
 * Returns a list of available WhatsApp message templates.
 */
router.get('/library', authMiddleware, async (req, res, next) => {
  try {
    const { category } = req.query;

    const templates = [
      {
        name: 'auth_otp',
        category: 'authentication',
        description: 'Authentication OTP for account verification.',
        variables: ['otp'],
        variable_hints: ['The 6-digit verification code'],
        body: 'Your verification code is {{otp}}. Please do not share this code with anyone.'
      },
      {
        name: 'order_update',
        category: 'utility',
        description: 'Update customers on their order status.',
        variables: ['customer_name', 'order_id', 'status'],
        variable_hints: ['Customer name', 'Order ID', 'Order status'],
        body: 'Hello {{customer_name}}, your order #{{order_id}} is now {{status}}. Thank you for shopping with us!'
      },
      {
        name: 'appointment_reminder',
        category: 'appointment',
        description: 'Remind customers of their upcoming appointments.',
        variables: ['customer_name', 'service', 'date', 'time'],
        variable_hints: ['Customer name', 'Service name', 'Appointment date', 'Appointment time'],
        body: 'Hi {{customer_name}}, this is a reminder for your {{service}} on {{date}} at {{time}}. See you then!'
      },
      {
        name: 'seasonal_promotion',
        category: 'marketing',
        description: 'Promotional message for seasonal sales.',
        variables: ['customer_name', 'discount_code', 'expiry_date'],
        variable_hints: ['Customer name', 'Discount code', 'Expiry date'],
        body: 'Hey {{customer_name}}! Get 20% off your next purchase with code {{discount_code}}. Offer valid until {{expiry_date}}.'
      },
      {
        name: 'cs_welcome',
        category: 'customer_service',
        description: 'Greeting message for new customers.',
        variables: ['agent_name'],
        variable_hints: ['Support agent name'],
        body: 'Hello! I am {{agent_name}} from the Zaplink support team. How can I help you today?'
      }
    ];

    const filteredTemplates = category 
      ? templates.filter(t => t.category === category)
      : templates;

    res.json({
      success: true,
      data: {
        success: true,
        templates: filteredTemplates
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
