import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlpacaService } from '../alpaca/alpaca.service';
import { SupabaseService, OrderStatus } from '../supabase/supabase.service';

const VALID_ALPACA_STATUSES: OrderStatus[] = [
  'accepted',
  'pending_new',
  'new',
  'fill',
  'partial_fill',
  'canceled',
  'expired',
];

@Injectable()
export class AlpacaOrderPollingService {
  private readonly logger = new Logger(AlpacaOrderPollingService.name);

  constructor(
    private alpacaService: AlpacaService,
    private supabaseService: SupabaseService,
  ) {}

  @Cron('*/15 * * * * *') // Run every 15 seconds
  async pollAlpacaOrderStatuses() {
    try {
      this.logger.log('Polling Alpaca order statuses...');

      const pendingOrders =
        await this.supabaseService.getOrdersByStatuses([
          'accepted',
          'pending_new',
          'new',
        ]);

      if (pendingOrders.length === 0) {
        this.logger.log('No in-progress orders to check');
        return;
      }

      this.logger.log(
        `Checking ${pendingOrders.length} in-progress order(s) against Alpaca`,
      );

      for (const order of pendingOrders) {
        if (!order.alpaca_order_id) {
          this.logger.warn(
            `Order ${order.transaction_hash} has no alpaca_order_id, skipping`,
          );
          continue;
        }

        try {
          const alpacaStatus = await this.alpacaService.getOrderStatus(
            order.alpaca_order_id,
          );

          if (
            alpacaStatus !== order.status &&
            VALID_ALPACA_STATUSES.includes(alpacaStatus as OrderStatus)
          ) {
            await this.supabaseService.updateOrderStatus(
              order.transaction_hash,
              alpacaStatus as OrderStatus,
            );
            this.logger.log(
              `Updated order ${order.transaction_hash}: ${order.status} → ${alpacaStatus}`,
            );
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to check Alpaca status for order ${order.alpaca_order_id}: ${error.message}`,
          );
        }
      }

      this.logger.log('Alpaca order status poll cycle complete');
    } catch (error: any) {
      this.logger.error(
        `Error polling Alpaca order statuses: ${error.message}`,
        error.stack,
      );
    }
  }
}
