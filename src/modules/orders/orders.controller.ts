import { Controller, Get, Param, Query } from '@nestjs/common';
import { OrdersService, PaginatedOrders } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get(':userPubkey')
  async getUserOrders(
    @Param('userPubkey') userPubkey: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedOrders> {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '10', 10) || 10));

    return this.ordersService.getUserOrders(userPubkey, pageNum, limitNum);
  }
}
