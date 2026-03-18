import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { clusterApiUrl, Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction
} from '@solana/spl-token';
import { AnchorProvider, Idl, Program, BN, Wallet } from '@coral-xyz/anchor';
import { BuyOrderCreated, SellOrderCreated } from '../pooling/decoder';
import rwaIdl from '../pooling/idl/program.json';

@Injectable()
export class Web3Service {
  private readonly logger = new Logger(Web3Service.name);
  private readonly credentialPda: PublicKey;
  private readonly schemaPda: PublicKey;
  private readonly sasProgramId: PublicKey;
  private readonly lqdPubkey: PublicKey;
  private readonly spoutProgramId: PublicKey;
  private readonly tokenProgramId: PublicKey;
  private readonly associatedTokenProgramId: PublicKey;
  private readonly configPda: PublicKey;
  private readonly issuerKeypair: Keypair;
  private readonly connection: Connection;
  private readonly usdcPubkey: PublicKey;
  private readonly usdcTokenProgramId: PublicKey;

  constructor(private configService: ConfigService) {
    // Initialize environment variables
    const credentialPdaStr = this.configService.get<string>('CREDENTIAL_PDA');
    const schemaPdaStr = this.configService.get<string>('SCHEMA_PDA');
    const sasProgramIdStr = this.configService.get<string>('SAS_PROGRAM_ID');
    const mintPubkeyStr = this.configService.get<string>('LQD_PUBKEY');
    const spoutProgramIdStr = this.configService.get<string>('SPOUT_PROGRAM_ID');
    const configPdaStr = this.configService.get<string>('CONFIG_PDA');
    const issuerKeypairStr = this.configService.get<string>('ISSUER_KEYPAIR');
    const tokenProgramIdStr = this.configService.get<string>('TOKEN_PROGRAM_ID');
    const associatedTokenProgramIdStr = this.configService.get<string>('ASSOCIATED_TOKEN_PROGRAM_ID');
    const usdcPubkeyStr = this.configService.get<string>('USDC_PUBKEY');
    const usdcTokenProgramIdStr = this.configService.get<string>('USDC_TOKEN_PROGRAM_ID');

    if (!credentialPdaStr || !schemaPdaStr || !sasProgramIdStr || !mintPubkeyStr || !spoutProgramIdStr || !configPdaStr || !issuerKeypairStr || !tokenProgramIdStr || !associatedTokenProgramIdStr || !usdcPubkeyStr || !usdcTokenProgramIdStr) {
      throw new Error('Required environment variables are missing: CREDENTIAL_PDA, SCHEMA_PDA, SAS_PROGRAM_ID, LQD_PUBKEY, RWA_PROGRAM_ID, SPOUT_PROGRAM_ID, CONFIG_PDA, ISSUER_KEYPAIR, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, USDC_PUBKEY, USDC_TOKEN_PROGRAM_ID');
    }

    this.credentialPda = new PublicKey(credentialPdaStr);
    this.schemaPda = new PublicKey(schemaPdaStr);
    this.sasProgramId = new PublicKey(sasProgramIdStr);
    this.lqdPubkey = new PublicKey(mintPubkeyStr);
    this.spoutProgramId = new PublicKey(spoutProgramIdStr);
    this.configPda = new PublicKey(configPdaStr);
    this.tokenProgramId = new PublicKey(tokenProgramIdStr);
    this.associatedTokenProgramId = new PublicKey(associatedTokenProgramIdStr);
    this.usdcPubkey = new PublicKey(usdcPubkeyStr);
    this.usdcTokenProgramId = new PublicKey(usdcTokenProgramIdStr);
    
    // Parse the issuer keypair from base58 string
    const issuerKeypairArray = JSON.parse(issuerKeypairStr);
    this.issuerKeypair = Keypair.fromSecretKey(new Uint8Array(issuerKeypairArray));
    
    // Initialize Solana connection
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  }

  async mintToken(buyOrder: BuyOrderCreated): Promise<void> {
    try {
      const userPubkey = buyOrder.user;
      
      // Derive user attestation PDA
      const [userAttestationPda, ] = this.deriveUserAttestationPda(
        userPubkey,
        this.credentialPda,
        this.schemaPda,
        this.sasProgramId,
      );
      console.log(`User Attestation PDA: ${userAttestationPda.toString()}`);

      // Derive program authority PDA
      const [programAuthorityPda, ] = this.deriveProgramAuthorityPda(
        this.lqdPubkey,
        this.spoutProgramId,
      );
      console.log(`Program Authority PDA: ${programAuthorityPda.toString()}`);

      // Ensure user's associated token account (ATA) exists (creates if needed)
      const userTokenAccount = await this.getUserAssociatedTokenAddress(userPubkey);
      console.log(`User Token Account: ${userTokenAccount.toString()}`);

      // Minting RWA Token
      const wallet = new Wallet(this.issuerKeypair);
      const provider = new AnchorProvider(this.connection, wallet, {});
      const rwaIdlData = rwaIdl as unknown as Idl;
      const program = new Program(rwaIdlData, provider);
      
      // Log all values being passed to the mint function
      this.logger.log(`  User Pubkey: ${userPubkey.toString()}`);
      this.logger.log(`  Asset Amount: ${buyOrder.assetAmount}`);
      this.logger.log(`  USDC Amount: ${buyOrder.usdcAmount}`);
      this.logger.log(`  Issuer: ${this.issuerKeypair.publicKey.toString()}`);
      this.logger.log(`  Config: ${this.configPda.toString()}`);
      this.logger.log(`  Mint: ${this.lqdPubkey.toString()}`);
      this.logger.log(`  Program Authority: ${programAuthorityPda.toString()}`);
      this.logger.log(`  Recipient Token Account: ${userTokenAccount.toString()}`);
      this.logger.log(`  Recipient: ${userPubkey.toString()}`);
      this.logger.log(`  Schema Account: ${this.schemaPda.toString()}`);
      this.logger.log(`  Credential Account: ${this.credentialPda.toString()}`);
      this.logger.log(`  Attestation Account: ${userAttestationPda.toString()}`);
      this.logger.log(`  SAS Program: ${this.sasProgramId.toString()}`);
      this.logger.log(`  Token Program: ${this.tokenProgramId.toString()}`);
      
      const tx = await program.methods
        .mint(userPubkey, buyOrder.assetAmount)
        .accounts({
          issuer: this.issuerKeypair.publicKey,
          config: this.configPda,
          mint: this.lqdPubkey,
          programAuthority: programAuthorityPda,
          recipientTokenAccount: userTokenAccount,
          recipient: userPubkey,
          schemaAccount: this.schemaPda,
          credentialAccount: this.credentialPda,
          attestationAccount: userAttestationPda,
          sasProgram: this.sasProgramId,
          tokenProgram: this.tokenProgramId,
        })
        .signers([this.issuerKeypair])
        .rpc();
      console.log(`Mint Transaction: ${tx}`);

      this.logger.log(`Mint operation completed for user: ${userPubkey.toString()}`);
    } catch (error: any) {
      this.logger.error(`Error in mintToken: ${error.message}`, error.stack);
      throw error;
    }
  }

  async burnToken(sellOrder: SellOrderCreated): Promise<void> {
    try {
      const userPubkey = sellOrder.user;
      
      // Derive user attestation PDA
      const [userAttestationPda, ] = this.deriveUserAttestationPda(
        userPubkey,
        this.credentialPda,
        this.schemaPda,
        this.sasProgramId,
      );
      console.log(`User Attestation PDA: ${userAttestationPda.toString()}`);

      // Derive program authority PDA
      const [programAuthorityPda, ] = this.deriveProgramAuthorityPda(
        this.lqdPubkey,
        this.spoutProgramId,
      );
      console.log(`Program Authority PDA: ${programAuthorityPda.toString()}`);

      // Ensure user's associated token account (ATA) exists (creates if needed)
      const userTokenAccount = await this.getUserAssociatedTokenAddress(userPubkey);
      console.log(`User Token Account: ${userTokenAccount.toString()}`);

      // Setup Anchor program
      const wallet = new Wallet(this.issuerKeypair);
      const provider = new AnchorProvider(this.connection, wallet, {});
      const rwaIdlData = rwaIdl as unknown as Idl;
      const program = new Program(rwaIdlData, provider);

      // Log all values being passed to the burn function
      this.logger.log(`  User Pubkey: ${userPubkey.toString()}`);
      this.logger.log(`  Asset Amount: ${sellOrder.assetAmount}`);
      this.logger.log(`  USDC Amount: ${sellOrder.usdcAmount}`);
      this.logger.log(`  Issuer: ${this.issuerKeypair.publicKey.toString()}`);
      this.logger.log(`  Config: ${this.configPda.toString()}`);
      this.logger.log(`  Mint: ${this.lqdPubkey.toString()}`);
      this.logger.log(`  Program Authority: ${programAuthorityPda.toString()}`);
      this.logger.log(`  Owner Token Account: ${userTokenAccount.toString()}`);
      this.logger.log(`  Owner: ${userPubkey.toString()}`);
      this.logger.log(`  Token Program: ${this.tokenProgramId.toString()}`);

      // Execute burn instruction
      const tx = await program.methods
      .burn(new BN(sellOrder.assetAmount.toString()))
      .accounts({
        mint: this.lqdPubkey,
        owner: userPubkey,
        ownerTokenAccount: userTokenAccount,
        issuer: this.issuerKeypair.publicKey,
        config: this.configPda,
        programAuthority: programAuthorityPda,
        tokenProgram: this.tokenProgramId,
      })
      .signers([this.issuerKeypair])
      .rpc();

      console.log(`Burn Transaction: ${tx}`);

      this.logger.log(`Burn completed for user: ${userPubkey.toBase58()}`);

      // After successful burn, mint USDC tokens to the user
      await this.mintUsdcTokens(userPubkey, sellOrder.usdcAmount);

      this.logger.log(`User Attestation PDA: ${userAttestationPda.toString()}`);
            
    } catch (error: any) {
      this.logger.error(`Error in burnToken: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Derives the user attestation PDA
   */
  deriveUserAttestationPda(
    userPubkey: PublicKey,
    credentialPda: PublicKey,
    schemaPda: PublicKey,
    sasProgramId: PublicKey,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("attestation"),
        credentialPda.toBuffer(),
        schemaPda.toBuffer(),
        userPubkey.toBuffer(),
      ],
      sasProgramId,
    );
  }

  /**
   * Derives the program authority PDA
   */
  deriveProgramAuthorityPda(mintPubkey: PublicKey, spoutProgramId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("program_authority"), mintPubkey.toBuffer()],
      spoutProgramId,
    );
  }

  /**
   * Gets the associated token address for a user and creates it if it doesn't exist
   */
  async getUserAssociatedTokenAddress(userPubkey: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      this.lqdPubkey,   // mint address
      userPubkey,       // owner address
      false,            // allowOwnerOffCurve (false for normal wallets)
      this.tokenProgramId, // token program ID
      this.associatedTokenProgramId // associated token program ID
    );

    try {
      // Check if ATA exists
      const accountInfo = await this.connection.getAccountInfo(ata);
      
      if (!accountInfo) {
        // ATA doesn't exist, create it
        this.logger.log(`Creating ATA for user: ${userPubkey.toString()}`);
        
        const createAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
          this.issuerKeypair.publicKey, // payer
          ata,                          // associated token account
          userPubkey,                   // owner
          this.lqdPubkey,              // mint
          this.tokenProgramId,         // token program ID
          this.associatedTokenProgramId // associated token program ID
        );

        const transaction = new Transaction().add(createAtaInstruction);
        
        const signature = await this.connection.sendTransaction(transaction, [this.issuerKeypair]);
        
        // Wait for confirmation
        await this.connection.confirmTransaction(signature, 'confirmed');
        
        this.logger.log(`ATA created successfully. Transaction: ${signature}`);
      } else {
        this.logger.log(`ATA already exists for user: ${userPubkey.toString()}`);
      }
    } catch (error: any) {
      this.logger.error(`Error checking/creating ATA: ${error.message}`);
      throw error;
    }

    return ata;
  }

  /**
   * Gets the USDC associated token address for a user and creates it if it doesn't exist
   */
  async getUserUsdcAssociatedTokenAddress(userPubkey: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      this.usdcPubkey,   // USDC mint address
      userPubkey,        // owner address
      false,             // allowOwnerOffCurve (false for normal wallets)
      this.usdcTokenProgramId, // USDC token program ID
      this.associatedTokenProgramId // associated token program ID
    );

    try {
      // Check if ATA exists
      const accountInfo = await this.connection.getAccountInfo(ata);
      
      if (!accountInfo) {
        // ATA doesn't exist, create it
        this.logger.log(`Creating USDC ATA for user: ${userPubkey.toString()}`);
        
        const createAtaInstruction = createAssociatedTokenAccountIdempotentInstruction(
          this.issuerKeypair.publicKey, // payer
          ata,                          // associated token account
          userPubkey,                   // owner
          this.usdcPubkey,             // USDC mint
          this.usdcTokenProgramId,     // USDC token program ID
          this.associatedTokenProgramId // associated token program ID
        );

        const transaction = new Transaction().add(createAtaInstruction);
        
        const signature = await this.connection.sendTransaction(transaction, [this.issuerKeypair]);
        
        // Wait for confirmation
        await this.connection.confirmTransaction(signature, 'confirmed');
        
        this.logger.log(`USDC ATA created successfully. Transaction: ${signature}`);
      } else {
        this.logger.log(`USDC ATA already exists for user: ${userPubkey.toString()}`);
      }
    } catch (error: any) {
      this.logger.error(`Error checking/creating USDC ATA: ${error.message}`);
      throw error;
    }

    return ata;
  }

  /**
   * Mints USDC tokens to a user's associated token account
   */
  async mintUsdcTokens(userPubkey: PublicKey, amount: BN): Promise<void> {
    try {
      this.logger.log(`Minting ${amount.toString()} USDC tokens to user: ${userPubkey.toString()}`);

      // Get or create user's USDC ATA
      const userUsdcTokenAccount = await this.getUserUsdcAssociatedTokenAddress(userPubkey);
      console.log(`User USDC Token Account: ${userUsdcTokenAccount.toString()}`);

      // Create mint instruction for USDC tokens
      const mintInstruction = createMintToInstruction(
        this.usdcPubkey,              // USDC mint address
        userUsdcTokenAccount,         // destination token account
        this.issuerKeypair.publicKey, // mint authority (assuming issuer has mint authority)
        BigInt(amount.toString()),    // amount to mint (as bigint)
        [],                           // multi-signers (empty for single signer)
        this.usdcTokenProgramId       // USDC token program ID
      );

      // Create and send transaction
      const transaction = new Transaction().add(mintInstruction);
      
      const signature = await this.connection.sendTransaction(transaction, [this.issuerKeypair]);
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');
      
      this.logger.log(`USDC mint completed successfully. Transaction: ${signature}`);
      console.log(`USDC Mint Transaction: ${signature}`);
      
    } catch (error: any) {
      this.logger.error(`Error minting USDC tokens: ${error.message}`, error.stack);
      throw error;
    }
  }
}
