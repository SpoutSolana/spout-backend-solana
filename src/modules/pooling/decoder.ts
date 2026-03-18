import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Event interfaces matching the Rust structs
export interface BuyOrderCreated {
  user: PublicKey;
  ticker: string;
  tokenMint: PublicKey;
  usdcAmount: BN;
  assetAmount: BN;
  price: BN;
  limitPrice: BN;
  orderId: BN;
  createdAt: BN;
}

export interface SellOrderCreated {
  user: PublicKey;
  ticker: string;
  tokenMint: PublicKey;
  usdcAmount: BN;
  assetAmount: BN;
  price: BN;
  limitPrice: BN;
  orderId: BN;
  createdAt: BN;
}

// Event decoder class
export class EventDecoder {
  /**
   * Decode BuyOrderCreated event data
   */
  static decodeBuyOrderCreated(data: any): BuyOrderCreated {
    return {
      user: new PublicKey(data.user),
      ticker: data.ticker,
      tokenMint: new PublicKey(data.tokenMint || data.token_mint),
      usdcAmount: new BN(data.usdcAmount || data.usdc_amount),
      assetAmount: new BN(data.assetAmount || data.asset_amount),
      price: new BN(data.price),
      limitPrice: new BN(data.limitPrice || data.limit_price),
      orderId: new BN(data.orderId || data.order_id),
      createdAt: new BN(data.createdAt || data.created_at),
    };
  }

  /**
   * Decode SellOrderCreated event data
   */
  static decodeSellOrderCreated(data: any): SellOrderCreated {
    return {
      user: new PublicKey(data.user),
      ticker: data.ticker,
      tokenMint: new PublicKey(data.tokenMint || data.token_mint),
      usdcAmount: new BN(data.usdcAmount || data.usdc_amount),
      assetAmount: new BN(data.assetAmount || data.asset_amount),
      price: new BN(data.price),
      limitPrice: new BN(data.limitPrice || data.limit_price),
      orderId: new BN(data.orderId || data.order_id),
      createdAt: new BN(data.createdAt || data.created_at),
    };
  }
}
