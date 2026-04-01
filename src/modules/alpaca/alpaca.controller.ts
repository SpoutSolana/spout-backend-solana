import { Controller, Delete, NotFoundException, Param } from '@nestjs/common';
import { AlpacaService } from './alpaca.service';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('alpaca')
export class AlpacaController {
  constructor(
    private alpacaService: AlpacaService,
    private supabaseService: SupabaseService,
  ) {}

  @Delete('orders/:orderId')
  async cancelOrder(@Param('orderId') orderId: string) {
    const order = await this.supabaseService.getOrderByOrderId(orderId);

    if (!order || !order.alpaca_order_id) {
      throw new NotFoundException(
        `Order with id ${orderId} not found or has no alpaca order`,
      );
    }

    return this.alpacaService.cancelOrder(order.alpaca_order_id);
  }
}
