import { Module } from '@nestjs/common';
import { PoolingService } from './pooling.service';
import { Web3Module } from '../web3/web3.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [Web3Module, SupabaseModule],
  providers: [PoolingService],
  exports: [PoolingService],
})
export class PoolingModule {}
