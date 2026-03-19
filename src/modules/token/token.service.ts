import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
  SendTransactionError,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AnchorProvider, Idl, Program, Wallet } from '@coral-xyz/anchor';
import { OrderRecord } from '../supabase/supabase.service';
import spoutOrdersIdl from '../pooling/idl/program.json';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly spoutProgramId: PublicKey;
  private readonly sstsProgramId: PublicKey;
  private readonly idProgramId: PublicKey;
  private readonly issuerKeypair: Keypair;
  private readonly mintCreator: PublicKey;
  private readonly verificationProgramId: PublicKey;
  private readonly usdcMint: PublicKey;
  private readonly connection: Connection;
  private readonly program: Program;

  constructor(private configService: ConfigService) {
    const spoutProgramIdStr = this.configService.get<string>('SPOUT_PROGRAM_ID');
    const sstsProgramIdStr = this.configService.get<string>('SSTS_PROGRAM_ID');
    const idProgramIdStr = this.configService.get<string>('ID_PROGRAM_ID'); //on chain id program
    const issuerKeypairStr = this.configService.get<string>('ISSUER_KEYPAIR');
    const mintCreatorStr = this.configService.get<string>('MINT_CREATOR');
    const verificationProgramIdStr = this.configService.get<string>('VERFICATION_PROGRAM_ID');
    const usdcMintStr = this.configService.get<string>('USDC_PUBKEY');

    if (!spoutProgramIdStr || !sstsProgramIdStr || !idProgramIdStr || !issuerKeypairStr || !mintCreatorStr || !verificationProgramIdStr || !usdcMintStr) {
      throw new Error(
        'Required environment variables are missing: SPOUT_PROGRAM_ID, SSTS_PROGRAM_ID, ID_PROGRAM_ID, ISSUER_KEYPAIR, MINT_CREATOR, VERFICATION_PROGRAM_ID, USDC_PUBKEY',
      );
    }

    this.spoutProgramId = new PublicKey(spoutProgramIdStr);
    this.sstsProgramId = new PublicKey(sstsProgramIdStr);
    this.idProgramId = new PublicKey(idProgramIdStr);
    this.mintCreator = new PublicKey(mintCreatorStr);
    this.verificationProgramId = new PublicKey(verificationProgramIdStr);
    this.usdcMint = new PublicKey(usdcMintStr);

    const issuerKeypairArray = JSON.parse(issuerKeypairStr);
    this.issuerKeypair = Keypair.fromSecretKey(new Uint8Array(issuerKeypairArray));

    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    const wallet = new Wallet(this.issuerKeypair);
    const provider = new AnchorProvider(this.connection, wallet, {});
    const idlData = spoutOrdersIdl as unknown as Idl;
    this.program = new Program(idlData, provider);

    this.logger.log('TokenService initialized');
  }

  async fulfillBuyOrder(order: OrderRecord): Promise<string> {
    const user = new PublicKey(order.user_pubkey);
    const mint = new PublicKey(order.token_mint);
    const orderId = BigInt(order.order_id);

    this.logger.log(
      `Fulfilling buy order: user=${order.user_pubkey}, mint=${order.token_mint}, orderId=${order.order_id}`,
    );

    // Derive PDAs
    const [orderConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('order_config')],
      this.spoutProgramId,
    );

    const [pendingOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), user.toBuffer(), this.u64ToLeBytes(orderId)],
      this.spoutProgramId,
    );

    const [ordersAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('orders_authority')],
      this.spoutProgramId,
    );

    const [sstsMintAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint.authority'), mint.toBuffer(), this.mintCreator.toBuffer()],
      this.sstsProgramId,
    );

    const [sstsVerificationConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('verification_config'), mint.toBuffer(), Buffer.from([6])],
      this.sstsProgramId,
    );

    const [buyerIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from('identity'), user.toBuffer()],
      this.idProgramId,
    );

    // Get or create buyer's ATA for this mint (Token-2022)
    const buyerAta = getAssociatedTokenAddressSync(
      mint,
      user,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    this.logger.log(`Derived PDAs:
  orderConfig: ${orderConfig.toString()}
  pendingOrder: ${pendingOrder.toString()}
  ordersAuthority: ${ordersAuthority.toString()}
  sstsMintAuthority: ${sstsMintAuthority.toString()}
  sstsVerificationConfig: ${sstsVerificationConfig.toString()}
  buyerIdentity: ${buyerIdentity.toString()}
  buyerAta: ${buyerAta.toString()}
  mintCreator: ${this.mintCreator.toString()}`);

    await this.ensureAtaExists(buyerAta, user, mint);

    const amount = BigInt(order.asset_amount);

    // Build SSTS verification instruction (instruction 0)
    const verificationData = Buffer.alloc(9);
    verificationData.writeUInt8(6, 0); // SSTS Mint discriminator
    verificationData.writeBigUInt64LE(amount, 1);

    const verificationIx = new TransactionInstruction({
      programId: this.verificationProgramId,
      keys: [
        { pubkey: sstsMintAuthority, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: buyerIdentity, isSigner: false, isWritable: false },
        { pubkey: orderConfig, isSigner: false, isWritable: false },
        { pubkey: this.issuerKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: verificationData,
    });

    // Build fulfill_buy_order instruction (instruction 1)
    const fulfillIx = await this.program.methods
      .fulfillBuyOrder()
      .accounts({
        orderConfig,
        pendingOrder,
        ordersAuthority,
        authority: this.issuerKeypair.publicKey,
        sstsProgram: this.sstsProgramId,
        tokenMint: mint,
        sstsVerificationConfig,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        sstsMintAuthority,
        buyerTokenAccount: buyerAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    // Send as single atomic transaction
    const tx = new Transaction();
    tx.add(verificationIx);
    tx.add(fulfillIx);

    try {
      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.issuerKeypair]);
      this.logger.log(`Buy order fulfilled successfully. Transaction: ${signature}`);
      return signature;
    } catch (err) {
      if (err instanceof SendTransactionError) {
        const logs = await err.getLogs(this.connection);
        this.logger.error(`Transaction failed. Full logs:\n${logs?.join('\n')}`);
      }
      throw err;
    }
  }

  async fulfillSellOrder(order: OrderRecord): Promise<string> {
    const user = new PublicKey(order.user_pubkey);
    const mint = new PublicKey(order.token_mint);
    const orderId = BigInt(order.order_id);

    this.logger.log(
      `Fulfilling sell order: user=${order.user_pubkey}, mint=${order.token_mint}, orderId=${order.order_id}`,
    );

    // Derive PDAs
    const [orderConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('order_config')],
      this.spoutProgramId,
    );

    const [pendingOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), user.toBuffer(), this.u64ToLeBytes(orderId)],
      this.spoutProgramId,
    );

    const [ordersAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('orders_authority')],
      this.spoutProgramId,
    );

    const [sstsPermanentDelegate] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint.permanent_delegate'), mint.toBuffer()],
      this.sstsProgramId,
    );

    const [sstsVerificationConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('verification_config'), mint.toBuffer(), Buffer.from([7])],
      this.sstsProgramId,
    );

    const [sellerIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from('identity'), user.toBuffer()],
      this.idProgramId,
    );

    const [usdcEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from('usdc_escrow')],
      this.spoutProgramId,
    );

    // Seller's token ATA (Token-2022)
    const sellerAta = getAssociatedTokenAddressSync(
      mint,
      user,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Seller's USDC ATA (legacy SPL Token)
    const sellerUsdcAta = getAssociatedTokenAddressSync(
      this.usdcMint,
      user,
      false,
      TOKEN_PROGRAM_ID,
    );

    // Ensure both ATAs exist
    await this.ensureAtaExists(sellerAta, user, mint, TOKEN_2022_PROGRAM_ID);
    await this.ensureAtaExists(sellerUsdcAta, user, this.usdcMint, TOKEN_PROGRAM_ID);

    this.logger.log(`Derived PDAs (sell):
  orderConfig: ${orderConfig.toString()}
  pendingOrder: ${pendingOrder.toString()}
  ordersAuthority: ${ordersAuthority.toString()}
  sstsPermanentDelegate: ${sstsPermanentDelegate.toString()}
  sstsVerificationConfig: ${sstsVerificationConfig.toString()}
  sellerIdentity: ${sellerIdentity.toString()}
  sellerAta: ${sellerAta.toString()}
  sellerUsdcAta: ${sellerUsdcAta.toString()}
  usdcEscrow: ${usdcEscrow.toString()}`);

    const amount = BigInt(order.asset_amount);

    // Build SSTS verification instruction (instruction 0)
    const verificationData = Buffer.alloc(9);
    verificationData.writeUInt8(7, 0); // SSTS Burn discriminator
    verificationData.writeBigUInt64LE(amount, 1);

    const verificationIx = new TransactionInstruction({
      programId: this.verificationProgramId,
      keys: [
        { pubkey: sstsPermanentDelegate, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: sellerAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: sellerIdentity, isSigner: false, isWritable: false },
        { pubkey: orderConfig, isSigner: false, isWritable: false },
        { pubkey: this.issuerKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: verificationData,
    });

    // Build fulfill_sell_order instruction (instruction 1)
    const fulfillIx = await this.program.methods
      .fulfillSellOrder()
      .accounts({
        orderConfig,
        pendingOrder,
        authority: this.issuerKeypair.publicKey,
        sstsProgram: this.sstsProgramId,
        tokenMint: mint,
        sstsVerificationConfig,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        sstsPermanentDelegate,
        sellerTokenAccount: sellerAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        usdcEscrow,
        ordersAuthority,
        sellerUsdcAccount: sellerUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // Send as single atomic transaction
    const tx = new Transaction();
    tx.add(verificationIx);
    tx.add(fulfillIx);

    try {
      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.issuerKeypair]);
      this.logger.log(`Sell order fulfilled successfully. Transaction: ${signature}`);
      return signature;
    } catch (err) {
      if (err instanceof SendTransactionError) {
        const logs = await err.getLogs(this.connection);
        this.logger.error(`Transaction failed. Full logs:\n${logs?.join('\n')}`);
      }
      throw err;
    }
  }

  private async ensureAtaExists(
    ata: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
    tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID,
  ): Promise<void> {
    const accountInfo = await this.connection.getAccountInfo(ata);
    if (!accountInfo) {
      this.logger.log(`Creating ATA for user: ${owner.toString()} (mint: ${mint.toString()})`);
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        this.issuerKeypair.publicKey,
        ata,
        owner,
        mint,
        tokenProgramId,
      );
      const tx = new Transaction().add(createAtaIx);
      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.issuerKeypair]);
      this.logger.log(`ATA created. Transaction: ${signature}`);
    }
  }

  private u64ToLeBytes(value: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value);
    return buf;
  }
}
