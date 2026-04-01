import { Controller, Delete, Param } from '@nestjs/common';
import { AlpacaService } from './alpaca.service';

@Controller('alpaca')
export class AlpacaController {
  constructor(private alpacaService: AlpacaService) {}

  @Delete('orders/:orderId')
  async cancelOrder(@Param('orderId') orderId: string) {
    return this.alpacaService.cancelOrder(orderId);
  }
}
