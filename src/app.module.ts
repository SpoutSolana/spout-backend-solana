import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoolingModule } from './modules/pooling/pooling.module';
import { KycModule } from './modules/kyc/kyc.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AlpacaModule } from './modules/alpaca/alpaca.module';
import { TokenModule } from './modules/token/token.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PoolingModule,
    KycModule,
    OrdersModule,
    AlpacaModule,
    TokenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
