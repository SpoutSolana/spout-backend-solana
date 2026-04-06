import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  Connection,
  clusterApiUrl,
  PublicKey,
} from '@solana/web3.js';
import {
  AnchorProvider,
  Idl,
  Program,
  BorshCoder,
  EventParser,
} from '@coral-xyz/anchor';
import idl from './idl/program.json'; // your program's IDL file
import { EventDecoder, BuyOrderCreated, SellOrderCreated } from './decoder';
import { SupabaseService } from '../supabase/supabase.service';
import { AlpacaService } from '../alpaca/alpaca.service';

@Injectable()
export class PoolingService {
  private readonly logger = new Logger(PoolingService.name);
  private readonly PROGRAM_ID: PublicKey;
  private readonly connection: Connection;
  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private alpacaService: AlpacaService,
  ) {
    // Initialize the program ID from environment variable
    const programId = this.configService.get<string>('SPOUT_PROGRAM_ID');
    if (!programId) {
      throw new Error('SPOUT_PROGRAM_ID environment variable is required');
    }
    this.PROGRAM_ID = new PublicKey(programId);

    // Initialize connection to Solana devnet
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.logger.log('Solana polling service initialized');
    this.logger.log(`Using program ID: ${this.PROGRAM_ID.toString()}`);
  }

  @Cron('*/15 * * * * *') // Run every 15 seconds
  async pollForOrderEvents() {
    try {
      this.logger.log('POLLING ORDER EVENTS');

      // Create Provider
      const provider = new AnchorProvider(this.connection, {} as any, {});

      // Get IDL
      const idlData = idl as unknown as Idl;
      if (!idlData) {
        this.logger.error(`No IDL found for program ${this.PROGRAM_ID.toString()}`);
        return;
      }

      // Initialize Program, Coder, and Parser
      const program = new Program(idlData, provider);
      const coder = new BorshCoder(idlData);
      const parser = new EventParser(this.PROGRAM_ID, coder);

      // Fetch recent transaction signatures
      const signatures = await provider.connection.getSignaturesForAddress(
        this.PROGRAM_ID,
        { limit: 2 },
      );

      // Collect all decoded orders
      const collectedOrders: { order: BuyOrderCreated | SellOrderCreated; type: 'buy' | 'sell'; txHash: string }[] = [];

      for (const sigInfo of signatures) {
        const tx = await provider.connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta?.logMessages) continue;
        const events = parser.parseLogs(tx.meta.logMessages);

        for (const evt of events) {
          if (evt.name === 'BuyOrderCreated') {
            try {
              const decodedOrder = EventDecoder.decodeBuyOrderCreated(evt.data);
              collectedOrders.push({ order: decodedOrder, type: 'buy', txHash: sigInfo.signature });
            } catch (error: any) {
              this.logger.error(`Failed to decode BuyOrderCreated event: ${error.message}`);
            }
          } else if (evt.name === 'SellOrderCreated') {
            try {
              const decodedOrder = EventDecoder.decodeSellOrderCreated(evt.data);
              collectedOrders.push({ order: decodedOrder, type: 'sell', txHash: sigInfo.signature });
            } catch (error: any) {
              this.logger.error(`Failed to decode SellOrderCreated event: ${error.message}`);
            }
          }
        }
      }

      // Filter duplicates via Supabase (without inserting)
      if (collectedOrders.length > 0) {
        const newOrders = await this.supabaseService.filterNewOrders(collectedOrders);

        // Place Alpaca order first, then insert into Supabase with the alpaca_order_id
        for (const orderData of newOrders) {
          const order = orderData.order;
          this.logger.log(
            `NEW ${orderData.type.toUpperCase()} ORDER:\n` +
            `  User: ${order.user.toString()}\n` +
            `  Ticker: ${order.ticker}\n` +
            `  Order ID: ${order.orderId.toString()}\n` +
            `  Transaction: ${orderData.txHash}\n` +
            `  AssetAmount: ${order.assetAmount}\n` +
            `  AssetAmount: ${(Number(order.assetAmount.toString()) / 1e6).toFixed(9)}\n` +
            `  LimitPrice: ${(Number(order.limitPrice.toString()) / 1e18)}`,
          );

          try {
            const limitPrice = Number(order.limitPrice.toString()) / 1e18;
            const alpacaResponse = await this.alpacaService.placeLimitOrder(
              order.ticker,
              (Number(order.assetAmount.toString()) / 1e6).toFixed(9),
              orderData.type,
              limitPrice,
            );
            this.logger.log(
              `Alpaca order placed for ${order.ticker}: ${JSON.stringify(alpacaResponse)}`,
            );

            // Insert into Supabase only after Alpaca responds
            if (alpacaResponse?.id) {
              await this.supabaseService.insertOrder(orderData, alpacaResponse.id);
            }
          } catch (error: any) {
            this.logger.error(
              `Failed to place Alpaca order for tx ${orderData.txHash}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log('POLLING ORDER EVENTS DONE');
    } catch (error: any) {
      this.logger.error(
        `Error while polling Solana order events: ${error.message}`,
        error.stack,
      );
    }
  }
}
