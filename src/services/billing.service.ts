import { createHash } from 'crypto';
import { tumaClient } from '@/lib/tumaClient';
import { InvoicesRepository, ProfilesRepository, PlansRepository } from '@/repositories';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const invoicesRepo = new InvoicesRepository();
const profilesRepo = new ProfilesRepository();
const plansRepo = new PlansRepository();

/**
 * Service to handle M-Pesa payments and user plan upgrades.
 * Implements Tuma STK Push integration and quota enforcement.
 */
export class BillingService {
  /**
   * Validates phone number to match Kenyan format (254XXXXXXXXX)
   */
  private validatePhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (/^254\d{9}$/.test(cleaned)) return cleaned;
    if (/^0\d{9}$/.test(cleaned)) return '254' + cleaned.substring(1);
    if (/^7\d{8}$/.test(cleaned) || /^1\d{8}$/.test(cleaned)) return '254' + cleaned;
    
    throw new AppError('INVALID_PHONE_NUMBER', 400, 'Invalid Kenyan phone number format. Use 254XXXXXXXXX');
  }

  /**
   * Generates a unique hash to prevent duplicate STK Push requests for same intent.
   */
  private generateIdempotencyKey(userId: string, planId: string, billingCycle: string): string {
    return createHash('sha256')
      .update(`${userId}:${planId}:${billingCycle}`)
      .digest('hex');
  }

  /**
   * Initiate STK Push payment and store pending invoice.
   */
  public async initiateStkPush(userId: string, planId: any, billingCycle: 'monthly' | 'yearly', phone: string) {
    const validatedPhone = this.validatePhone(phone);
    const plan = await plansRepo.findById(planId);
    
    const amount = billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
    const idempotencyKey = this.generateIdempotencyKey(userId, planId, billingCycle);

    // 1. Call Tuma STK Push API
    const response = await tumaClient.initiateStkPush({
      phoneNumber: validatedPhone,
      amount,
      description: `Subscription for ${plan.name} (${billingCycle})`,
    }) as any;

    try {
      // 2. Store payment_id + status=pending in invoices table
      await invoicesRepo.create({
        user_id: userId,
        invoice_number: `INV-${Date.now()}`,
        amount_kes: amount,
        status: 'pending',
        checkout_request_id: response.checkout_request_id,
        payment_id: response.checkout_request_id,
        plan_id: planId,
        idempotency_key: idempotencyKey,
      });
    } catch (err: any) {
      if (err.code === '23505') {
        throw new AppError('ALREADY_EXISTS', 400, 'A payment for this plan is already in progress');
      }
      throw err;
    }

    return { 
      payment_id: response.checkout_request_id, 
      message: response.customer_message || 'STK Push initiated successfully' 
    };
  }

  /**
   * Callback handler for Tuma webhook
   */
  public async handleWebhook(body: any) {
    const { checkout_request_id, result_code, result_desc, amount, mpesa_receipt_number } = body;

    const invoice = await invoicesRepo.findByCheckoutRequestId(checkout_request_id);
    if (!invoice) {
      logger.warn({ checkout_request_id }, '⚠️ Webhook received for unknown invoice');
      return;
    }

    if (invoice.status === 'paid') {
      logger.info({ checkout_request_id }, 'ℹ️ Webhook received for already paid invoice');
      return;
    }

    if (result_code === 0) {
      // Calculate expiration (monthly vs yearly)
      const expiresAt = new Date();
      const plan = await plansRepo.findById(invoice.plan_id || 'trial');
      if (invoice.amount_kes >= plan.price_yearly && plan.price_yearly > 0) {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }

      // 3. Upgrade user plan via atomic RPC to avoid race conditions
      await profilesRepo.upgradeUserPlan(
        invoice.user_id,
        invoice.plan_id || 'trial',
        expiresAt.toISOString(),
        invoice.id
      );

      // Store success details in invoice
      await invoicesRepo.update(invoice.id, {
        status: 'paid',
        external_payment_id: mpesa_receipt_number,
        result_code: result_code.toString(),
        result_desc: result_desc,
      });

      logger.info({ userId: invoice.user_id, planId: invoice.plan_id }, '✅ Plan upgraded after successful payment (Webhook)');
    } else {
      // Payment failed
      await invoicesRepo.update(invoice.id, {
        status: 'failed',
        result_code: result_code.toString(),
        result_desc: result_desc,
      });
      logger.warn({ checkout_request_id, result_desc }, '❌ Payment failed (Webhook)');
    }
  }

  /**
   * Status handler (kept for compatibility, though Tuma prefers webhooks)
   */
  public async pollPaymentStatus(paymentId: string) {
    const invoice = await invoicesRepo.findByCheckoutRequestId(paymentId);
    if (!invoice) throw new AppError('NOT_FOUND', 404, 'Invoice not found');

    if (invoice.status === 'paid') {
      return { status: 'completed', message: 'Payment successful' };
    }
    if (invoice.status === 'failed') {
      return { status: 'failed', message: invoice.result_desc || 'Payment failed' };
    }

    return { status: 'pending', message: 'Waiting for payment confirmation' };
  }

  /**
   * Atomic plan upgrade for a user.
   */
  public async upgradePlan(userId: string, planId: any) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    await profilesRepo.upgradeUserPlan(
      userId,
      planId,
      expiresAt.toISOString()
    );

    logger.info({ userId, planId }, '✅ Plan upgraded manually');
  }
}

export const billingService = new BillingService();
