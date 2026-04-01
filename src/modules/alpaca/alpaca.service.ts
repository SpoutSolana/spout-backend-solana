import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AlpacaService {
  private readonly logger = new Logger(AlpacaService.name);
  private apiKeyId: string;
  private apiSecretKey: string;
  private accountId: string;

  constructor(private configService: ConfigService) {
    this.apiKeyId = this.configService.get<string>('APCA_API_KEY_ID') || '';
    this.apiSecretKey =
      this.configService.get<string>('APCA_API_SECRET_KEY') || '';
    this.accountId = this.configService.get<string>('APCA_ACCOUNT_ID') || '';
  }

  async getLatestQuotes(symbols: string): Promise<any> {
    try {
      const response = await axios.get(
        'https://data.alpaca.markets/v2/stocks/quotes/latest',
        {
          params: { symbols },
          headers: {
            accept: 'application/json',
            'APCA-API-KEY-ID': this.apiKeyId,
            'APCA-API-SECRET-KEY': this.apiSecretKey,
          },
        },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        'Alpaca error:',
        error.response?.data || error.message,
      );
      throw new Error(`Failed to fetch quotes: ${error.message}`);
    }
  }

  async placeOrder(
    symbol: string,
    qty: string,
    side: 'buy' | 'sell',
  ): Promise<any> {
    try {
      const credentials = Buffer.from(
        `${this.apiKeyId}:${this.apiSecretKey}`,
      ).toString('base64');

      const orderRequest = {
        type: 'market',
        time_in_force: 'day',
        commission_type: 'notional',
        symbol,
        qty,
        side,
      };

      const response = await axios.post(
        `https://broker-api.alpaca.markets/v1/trading/accounts/${this.accountId}/orders`,
        orderRequest,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Basic ${credentials}`,
          },
        },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        'Alpaca order error:',
        error.response?.data || error.message,
      );
      throw new Error(
        `Failed to place order: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async getOrderStatus(orderId: string): Promise<string> {
    try {
      const credentials = Buffer.from(
        `${this.apiKeyId}:${this.apiSecretKey}`,
      ).toString('base64');

      const response = await axios.get(
        `https://broker-api.alpaca.markets/v1/trading/accounts/${this.accountId}/orders/${orderId}`,
        {
          headers: {
            accept: 'application/json',
            authorization: `Basic ${credentials}`,
          },
        },
      );

      return (response.data as any).status;
    } catch (error: any) {
      this.logger.error(
        'Alpaca order status error:',
        error.response?.data || error.message,
      );
      throw new Error(
        `Failed to check order status: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async cancelOrder(orderId: string): Promise<any> {
    try {
      const credentials = Buffer.from(
        `${this.apiKeyId}:${this.apiSecretKey}`,
      ).toString('base64');

      const response = await axios.delete(
        `https://broker-api.alpaca.markets/v1/trading/accounts/${this.accountId}/orders/${orderId}`,
        {
          headers: {
            accept: 'application/json',
            authorization: `Basic ${credentials}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        'Alpaca cancel order error:',
        error.response?.data || error.message,
      );
      throw new Error(
        `Failed to cancel order: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  async placeLimitOrder(
    symbol: string,
    qty: string,
    side: 'buy' | 'sell',
    limitPrice: number,
  ): Promise<any> {
    try {
      const credentials = Buffer.from(
        `${this.apiKeyId}:${this.apiSecretKey}`,
      ).toString('base64');

      const orderRequest = {
        symbol,
        qty,
        side,
        type: 'limit',
        time_in_force: 'day',
        limit_price: limitPrice,
        extended_hours: true,
      };

      const response = await axios.post(
        `https://broker-api.alpaca.markets/v1/trading/accounts/${this.accountId}/orders`,
        orderRequest,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Basic ${credentials}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        'Alpaca limit order error:',
        error.response?.data || error.message,
      );
      throw new Error(
        `Failed to place limit order: ${error.response?.data?.message || error.message}`,
      );
    }
  }
}
