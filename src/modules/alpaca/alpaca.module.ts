import { Module } from '@nestjs/common';
import { AlpacaController } from './alpaca.controller';
import { AlpacaService } from './alpaca.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [AlpacaController],
  providers: [AlpacaService],
  exports: [AlpacaService],
})
export class AlpacaModule {}
