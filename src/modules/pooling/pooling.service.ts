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
import { Web3Service } from '../web3/web3.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AlpacaService } from '../alpaca/alpaca.service';

@Injectable()
export class PoolingService {
  private readonly logger = new Logger(PoolingService.name);
  private readonly PROGRAM_ID: PublicKey;
  private readonly connection: Connection;
  constructor(
    private configService: ConfigService,
    private web3Service: Web3Service,
    private supabaseService: SupabaseService,
    private alpacaService: AlpacaService,
  ) {
    // Initialize the program ID from environment variable
    const programId = this.configService.get<string>('SPOUT_PROGRAM_ID');
    if (!programId) {
      throw new Error('SPOUT_PROGRAM_ID environment variable is required');
    }
    this.PROGRAM_ID = new PublicKey(programId);

    // Step 1. Initialize connection to Solana devnet
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.logger.log('Solana polling service initialized');
    this.logger.log(`Using program ID: ${this.PROGRAM_ID.toString()}`);
  }

  @Cron('*/15 * * * * *') // Run every 15 seconds
  async pollForOrderEvents() {
    try {
      this.logger.log('Polling Solana program events...');

      // Step 2. Create Provider
      const provider = new AnchorProvider(this.connection, {} as any, {});

      // Step 3. Get IDL
      const idlData = idl as unknown as Idl;
      if (!idlData) {
        this.logger.error(`No IDL found for program ${this.PROGRAM_ID.toString()}`);
        return;
      }

      // Step 4. Initialize Program, Coder, and Parser
      const program = new Program(idlData, provider);
      const coder = new BorshCoder(idlData);
      const parser = new EventParser(this.PROGRAM_ID, coder);

      // Step 5. Fetch recent transaction signatures
      const signatures = await provider.connection.getSignaturesForAddress(
        this.PROGRAM_ID,
        { limit: 5 },
      );
      console.log("Fetched signatures:", signatures.length);

      // Step 6. Collect all decoded orders
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

              this.logger.log(
                `\nBUY ORDER DETECTED:\n` +
                `  User: ${decodedOrder.user.toString()}\n` +
                `  Ticker: ${decodedOrder.ticker}\n` +
                `  Order ID: ${decodedOrder.orderId.toString()}\n` +
                `  Transaction: ${sigInfo.signature}`,
              );
            } catch (error: any) {
              this.logger.error(`Failed to decode BuyOrderCreated event: ${error.message}`);
            }
          } else if (evt.name === 'SellOrderCreated') {
            try {
              const decodedOrder = EventDecoder.decodeSellOrderCreated(evt.data);
              collectedOrders.push({ order: decodedOrder, type: 'sell', txHash: sigInfo.signature });

              this.logger.log(
                `\nSELL ORDER DETECTED:\n` +
                `  User: ${decodedOrder.user.toString()}\n` +
                `  Ticker: ${decodedOrder.ticker}\n` +
                `  Order ID: ${decodedOrder.orderId.toString()}\n` +
                `  Transaction: ${sigInfo.signature}`,
              );
            } catch (error: any) {
              this.logger.error(`Failed to decode SellOrderCreated event: ${error.message}`);
            }
          }
        }
      }

      // Step 7. Filter duplicates via Supabase and insert new orders
      if (collectedOrders.length > 0) {
        const newOrders = await this.supabaseService.processOrders(collectedOrders);

        // Step 8. Process only new orders (mint/burn + Alpaca)
        for (const record of newOrders) {
          // TODO: Re-enable mint/burn when ready
          // if (record.order_type === 'buy') {
          //   await this.web3Service.mintToken(...);
          // } else {
          //   await this.web3Service.burnToken(...);
          // }

          // Place market order on Alpaca
          try {
            const alpacaResponse = await this.alpacaService.placeOrder(
              record.ticker,
              record.asset_amount,
              record.order_type as 'buy' | 'sell',
            );
            this.logger.log(
              `Alpaca order placed for ${record.ticker}: ${JSON.stringify(alpacaResponse)}`,
            );

            // Save the Alpaca order ID for status tracking
            if (alpacaResponse?.id) {
              await this.supabaseService.updateAlpacaOrderId(
                record.transaction_hash,
                alpacaResponse.id,
              );
            }
          } catch (error: any) {
            this.logger.error(
              `Failed to place Alpaca order for tx ${record.transaction_hash}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log('Poll cycle complete');
    } catch (error: any) {
      this.logger.error(
        `Error while polling Solana order events: ${error.message}`,
        error.stack,
      );
    }
  }
}
