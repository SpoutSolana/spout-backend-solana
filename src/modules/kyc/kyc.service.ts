import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { AnchorProvider, Idl, Program, Wallet } from '@coral-xyz/anchor';
import idl from './idl/program.json';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly idProgramId: PublicKey;
  private readonly issuerKeypair: Keypair;
  private readonly connection: Connection;

  constructor(private configService: ConfigService) {
    const idProgramIdStr = this.configService.get<string>('ID_PROGRAM_ID');
    const issuerKeypairStr = this.configService.get<string>('ISSUER_KEYPAIR');

    if (!idProgramIdStr || !issuerKeypairStr) {
      throw new Error(
        'Required environment variables are missing: ID_PROGRAM_ID, ISSUER_KEYPAIR',
      );
    }

    this.idProgramId = new PublicKey(idProgramIdStr);
    this.issuerKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(issuerKeypairStr)),
    );
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    this.logger.log('KYC service initialized');
    this.logger.log(`Using ID program: ${this.idProgramId.toString()}`);
  }

  async createIdentityForUser(userWalletPubKey: string) {
    this.logger.log(`Creating identity for user: ${userWalletPubKey}`);

    const userKey = new PublicKey(userWalletPubKey);

    // Set up Anchor provider and program
    const issuerWallet = new Wallet(this.issuerKeypair);
    const provider = new AnchorProvider(this.connection, issuerWallet, {});
    const idlData = idl as unknown as Idl;
    const program = new Program(idlData, provider);

    // Derive config PDA
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      this.idProgramId,
    );

    // Derive identity PDA
    const [identityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('identity'), userKey.toBuffer()],
      this.idProgramId,
    );

    this.logger.log(`Config PDA: ${configPda.toString()}`);
    this.logger.log(`Identity PDA: ${identityPda.toString()}`);

    // Call create_identity_for_user instruction
    const tx = await program.methods
      .createIdentityForUser()
      .accounts({
        authority: this.issuerKeypair.publicKey,
        config: configPda,
        user: userKey,
        identity: identityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.issuerKeypair])
      .rpc();

    this.logger.log(`Identity created. Transaction: ${tx}`);

    // Call set_verified to mark the identity as KYC verified
    const verifyTx = await program.methods
      .setVerified(true)
      .accounts({
        authority: this.issuerKeypair.publicKey,
        config: configPda,
        identity: identityPda,
      })
      .signers([this.issuerKeypair])
      .rpc();

    this.logger.log(`Identity verified. Transaction: ${verifyTx}`);

    return {
      success: true,
      createTransactionSignature: tx,
      verifyTransactionSignature: verifyTx,
      identityPda: identityPda.toString(),
      user: userWalletPubKey,
    };
  }
}
