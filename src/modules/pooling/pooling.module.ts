import { Module } from '@nestjs/common';
import { PoolingService } from './pooling.service';
import { AlpacaOrderPollingService } from './alpaca-order-polling.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlpacaModule } from '../alpaca/alpaca.module';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [SupabaseModule, AlpacaModule, TokenModule],
  providers: [PoolingService, AlpacaOrderPollingService],
  exports: [PoolingService, AlpacaOrderPollingService],
})
export class PoolingModule {}
