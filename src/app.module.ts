import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PoolingModule } from './modules/pooling/pooling.module';
import { Web3Module } from './modules/web3/web3.module';
import { KycModule } from './modules/kyc/kyc.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AlpacaModule } from './modules/alpaca/alpaca.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PoolingModule,
    Web3Module,
    KycModule,
    OrdersModule,
    AlpacaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
