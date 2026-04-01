import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BuyOrderCreated, SellOrderCreated } from '../pooling/decoder';

export type OrderStatus =
  | 'accepted'
  | 'pending_new'
  | 'new'
  | 'fill'
  | 'filled'
  | 'partial_fill'
  | 'partially_filled'
  | 'canceled'
  | 'expired';

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
  alpaca_order_id: string | null;
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
   * Filter out orders that already exist in the database by transaction hash.
   * Returns only the new (unseen) orders without inserting them.
   */
  async filterNewOrders(
    orders: { order: BuyOrderCreated | SellOrderCreated; type: 'buy' | 'sell'; txHash: string }[],
  ): Promise<{ order: BuyOrderCreated | SellOrderCreated; type: 'buy' | 'sell'; txHash: string }[]> {
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

    const newOrders = orders.filter((o) => !existingHashes.has(o.txHash));

    if (newOrders.length === 0) {
      this.logger.log('No new orders found');
    }

    return newOrders;
  }

  /**
   * Insert a single order into the database with the Alpaca order ID already set.
   */
  async insertOrder(
    orderData: { order: BuyOrderCreated | SellOrderCreated; type: 'buy' | 'sell'; txHash: string },
    alpacaOrderId: string,
  ): Promise<OrderRecord> {
    const record: OrderRecord = {
      transaction_hash: orderData.txHash,
      order_type: orderData.type,
      status: 'accepted' as OrderStatus,
      alpaca_order_id: alpacaOrderId,
      user_pubkey: orderData.order.user.toString(),
      ticker: orderData.order.ticker,
      token_mint: orderData.order.tokenMint.toString(),
      usdc_amount: orderData.order.usdcAmount.toString(),
      asset_amount: orderData.order.assetAmount.toString(),
      price: orderData.order.price.toString(),
      limit_price: orderData.order.limitPrice.toString(),
      order_id: orderData.order.orderId.toString(),
      created_at_onchain: new Date(orderData.order.createdAt.toNumber() * 1000).toISOString(),
    };

    const { data, error: insertError } = await this.supabase
      .from('orders')
      .insert(record)
      .select()
      .single();

    if (insertError) {
      this.logger.error(`Failed to insert order: ${insertError.message}`);
      throw insertError;
    }

    this.logger.log(`Inserted order for tx ${orderData.txHash} with alpaca_order_id ${alpacaOrderId}`);
    return data as OrderRecord;
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

  async getOrderByOrderId(orderId: string): Promise<OrderRecord | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (error) {
      this.logger.error(`Failed to fetch order by order_id ${orderId}: ${error.message}`);
      return null;
    }

    return data as OrderRecord;
  }

  async getOrdersByStatuses(statuses: OrderStatus[]): Promise<OrderRecord[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('*')
      .in('status', statuses);

    if (error) {
      this.logger.error(`Failed to fetch orders with statuses ${statuses.join(', ')}: ${error.message}`);
      throw error;
    }

    return (data ?? []) as OrderRecord[];
  }

  async updateOrderStatus(transactionHash: string, status: OrderStatus): Promise<void> {
    const { error } = await this.supabase
      .from('orders')
      .update({ status })
      .eq('transaction_hash', transactionHash);

    if (error) {
      this.logger.error(`Failed to update order status for tx ${transactionHash}: ${error.message}`);
      throw error;
    }
  }

  async updateAlpacaOrderId(transactionHash: string, alpacaOrderId: string): Promise<void> {
    const { error } = await this.supabase
      .from('orders')
      .update({ alpaca_order_id: alpacaOrderId })
      .eq('transaction_hash', transactionHash);

    if (error) {
      this.logger.error(`Failed to update alpaca_order_id for tx ${transactionHash}: ${error.message}`);
      throw error;
    }
  }
}
