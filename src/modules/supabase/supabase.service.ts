import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BuyOrderCreated, SellOrderCreated } from '../pooling/decoder';

export type OrderStatus = 'pending' | 'fulfilled' | 'failed';

export interface OrderRecord {
  transaction_hash: string;
  order_type: 'buy' | 'sell';
  status: OrderStatus;
  user_pubkey: string;
  ticker: string;
  token_mint: string;
  usdc_amount: string;
  asset_amount: string;
  price: string;
  limit_price: string;
  order_id: string;
  created_at_onchain: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logger.log('Supabase client initialized');
  }

  /**
   * Filter out orders that already exist in the database by transaction hash,
   * then insert the new ones.
   */
  async processOrders(
    orders: { order: BuyOrderCreated | SellOrderCreated; type: 'buy' | 'sell'; txHash: string }[],
  ): Promise<OrderRecord[]> {
    if (orders.length === 0) return [];

    const txHashes = orders.map((o) => o.txHash);

    // Check which transaction hashes already exist
    const { data: existing, error: selectError } = await this.supabase
      .from('orders')
      .select('transaction_hash')
      .in('transaction_hash', txHashes);

    if (selectError) {
      this.logger.error(`Failed to query existing orders: ${selectError.message}`);
      throw selectError;
    }

    const existingHashes = new Set(existing?.map((r) => r.transaction_hash) ?? []);

    // Filter to only new orders
    const newOrders = orders.filter((o) => !existingHashes.has(o.txHash));

    if (newOrders.length === 0) {
      this.logger.log('No new orders to insert — all already exist in database');
      return [];
    }

    // Map to database records
    const records: OrderRecord[] = newOrders.map((o) => ({
      transaction_hash: o.txHash,
      order_type: o.type,
      status: 'pending' as OrderStatus,
      user_pubkey: o.order.user.toString(),
      ticker: o.order.ticker,
      token_mint: o.order.tokenMint.toString(),
      usdc_amount: o.order.usdcAmount.toString(),
      asset_amount: o.order.assetAmount.toString(),
      price: o.order.price.toString(),
      limit_price: o.order.limitPrice.toString(),
      order_id: o.order.orderId.toString(),
      created_at_onchain: new Date(o.order.createdAt.toNumber() * 1000).toISOString(),
    }));

    // Insert new orders
    const { data, error: insertError } = await this.supabase
      .from('orders')
      .insert(records)
      .select();

    if (insertError) {
      this.logger.error(`Failed to insert orders: ${insertError.message}`);
      throw insertError;
    }

    this.logger.log(`Inserted ${records.length} new order(s) into database`);
    return data as OrderRecord[];
  }

  async getOrdersByUser(
    userPubkey: string,
    page: number,
    limit: number,
  ): Promise<{ data: OrderRecord[]; total: number }> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await this.supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_pubkey', userPubkey)
      .order('created_at_onchain', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error(`Failed to fetch orders for user ${userPubkey}: ${error.message}`);
      throw error;
    }

    return { data: (data ?? []) as OrderRecord[], total: count ?? 0 };
  }
}
