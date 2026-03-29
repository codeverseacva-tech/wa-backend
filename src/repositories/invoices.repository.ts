import { BaseRepository, TransactionalClient, Pagination } from './base.repository';
import { AppError } from '@/lib/errors';

export interface Invoice {
  id: string;
  user_id: string;
  invoice_number: string;
  amount_kes: number;
  status: 'unpaid' | 'paid' | 'cancelled' | 'refunded' | 'pending' | 'failed';
  payment_id?: string;
  checkout_request_id?: string;
  plan_id?: 'trial' | 'starter' | 'business' | 'custom';
  idempotency_key?: string;
  result_code?: string;
  result_desc?: string;
  external_payment_id?: string;
  created_at: string;
  updated_at: string;
}

export class InvoicesRepository extends BaseRepository {
  public async create(invoice: Partial<Invoice>, tx?: TransactionalClient): Promise<Invoice> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('invoices')
      .insert(invoice)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Create invoice failed');
    }

    return data as Invoice;
  }

  public async findByNumber(invoiceNumber: string, tx?: TransactionalClient): Promise<Invoice> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('invoices')
      .select('*')
      .eq('invoice_number', invoiceNumber)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND', 404, `Invoice ${invoiceNumber} not found`);
    }

    return data as Invoice;
  }

  public async listByUser(userId: string, pagination?: Pagination, tx?: TransactionalClient): Promise<Invoice[]> {
    const client = this.getClient(tx);
    let query = client.from('invoices')
      .select('*')
      .eq('user_id', userId);

    query = this.applyPagination(query, pagination);
    const { data, error } = await query;
    if (error) throw new AppError('DATABASE_ERROR', 500, error.message);
    return data as Invoice[];
  }

  public async updateStatus(id: string, status: Invoice['status'], paymentId?: string, tx?: TransactionalClient): Promise<Invoice> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('invoices')
      .update({ status, payment_id: paymentId })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update invoice status failed');
    }

    return data as Invoice;
  }

  public async findByCheckoutRequestId(checkoutRequestId: string, tx?: TransactionalClient): Promise<Invoice> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('invoices')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND', 404, `Invoice with checkout request ID ${checkoutRequestId} not found`);
    }

    return data as Invoice;
  }

  public async update(id: string, updates: Partial<Invoice>, tx?: TransactionalClient): Promise<Invoice> {
    const client = this.getClient(tx);
    const { data, error } = await client
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('DATABASE_ERROR', 500, error?.message || 'Update invoice failed');
    }

    return data as Invoice;
  }
}
