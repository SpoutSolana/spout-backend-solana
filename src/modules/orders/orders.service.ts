import { Injectable } from '@nestjs/common';
import { SupabaseService, OrderRecord } from '../supabase/supabase.service';

export interface PaginatedOrders {
  orders: OrderRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class OrdersService {
  constructor(private supabaseService: SupabaseService) {}

  async getUserOrders(
    userPubkey: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedOrders> {
    const { data, total } = await this.supabaseService.getOrdersByUser(userPubkey, page, limit);

    return {
      orders: data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
