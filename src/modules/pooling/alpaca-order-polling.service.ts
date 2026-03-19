import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlpacaService } from '../alpaca/alpaca.service';
import { SupabaseService, OrderStatus } from '../supabase/supabase.service';
import { TokenService } from '../token/token.service';

const VALID_ALPACA_STATUSES: OrderStatus[] = [
  'accepted',
  'pending_new',
  'new',
  'fill',
  'filled',
  'partial_fill',
  'partially_filled',
  'canceled',
  'expired',
];

@Injectable()
export class AlpacaOrderPollingService {
  private readonly logger = new Logger(AlpacaOrderPollingService.name);

  constructor(
    private alpacaService: AlpacaService,
    private supabaseService: SupabaseService,
    private tokenService: TokenService,
  ) {}

  @Cron('*/20 * * * * *') // Run every 15 seconds
  async pollAlpacaOrderStatuses() {
    try {
      this.logger.log('POLLING ALPACA EVENTS');

      const pendingOrders =
        await this.supabaseService.getOrdersByStatuses([
          'accepted',
          'pending_new',
          'new',
        ]);

      if (pendingOrders.length === 0) {
        this.logger.log('POLLING ALPACA EVENTS DONE');
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

          this.logger.log(
            `Alpaca status for order ${order.alpaca_order_id} (tx: ${order.transaction_hash}): ${alpacaStatus} (current DB status: ${order.status})`,
          );

          if (
            alpacaStatus !== order.status &&
            VALID_ALPACA_STATUSES.includes(alpacaStatus as OrderStatus)
          ) {
            // When an order is filled, fulfill on-chain first, then update status
            if (alpacaStatus === 'filled') {
              try {
                const txSignature = order.order_type === 'buy'
                  ? await this.tokenService.fulfillBuyOrder(order)
                  : await this.tokenService.fulfillSellOrder(order);
                this.logger.log(
                  `${order.order_type} order fulfilled on-chain for tx ${order.transaction_hash}: ${txSignature}`,
                );

                await this.supabaseService.updateOrderStatus(
                  order.transaction_hash,
                  alpacaStatus as OrderStatus,
                );
                this.logger.log(
                  `Updated order ${order.transaction_hash}: ${order.status} → ${alpacaStatus}`,
                );
              } catch (fulfillError: any) {
                this.logger.error(
                  `Failed to fulfill ${order.order_type} order on-chain for tx ${order.transaction_hash}: ${fulfillError.message}`,
                );
              }
            } else {
              // For non-filled statuses, update status directly
              await this.supabaseService.updateOrderStatus(
                order.transaction_hash,
                alpacaStatus as OrderStatus,
              );
              this.logger.log(
                `Updated order ${order.transaction_hash}: ${order.status} → ${alpacaStatus}`,
              );
            }
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to check Alpaca status for order ${order.alpaca_order_id}: ${error.message}`,
          );
        }
      }

      this.logger.log('POLLING ALPACA EVENTS DONE');
    } catch (error: any) {
      this.logger.error(
        `Error polling Alpaca order statuses: ${error.message}`,
        error.stack,
      );
    }
  }
}
