import { Module } from '@nestjs/common';
import { PoolingService } from './pooling.service';
import { Web3Module } from '../web3/web3.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlpacaModule } from '../alpaca/alpaca.module';

@Module({
  imports: [Web3Module, SupabaseModule, AlpacaModule],
  providers: [PoolingService],
  exports: [PoolingService],
})
export class PoolingModule {}
