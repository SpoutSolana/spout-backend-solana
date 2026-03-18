import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { KycService } from './kyc.service';

export class CreateIdentityDto {
  @ApiProperty({ description: 'User wallet public key (Solana address)' })
  userWalletPubKey!: string;
}

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(private readonly kycService: KycService) {}

  @Post('create-identity-for-user')
  @ApiOperation({ summary: 'Create on-chain identity for a user' })
  @ApiBody({ type: CreateIdentityDto })
  @ApiResponse({ status: 201, description: 'Identity created successfully' })
  @ApiResponse({ status: 400, description: 'Missing required fields' })
  async createIdentity(@Body() dto: CreateIdentityDto) {
    try {
      this.logger.log(`Received create identity request for: ${dto.userWalletPubKey}`);

      if (!dto.userWalletPubKey) {
        throw new HttpException('userWalletPubKey is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.kycService.createIdentityForUser(dto.userWalletPubKey);

      this.logger.log(`Identity created successfully for: ${dto.userWalletPubKey}`);
      return result;
    } catch (error: any) {
      this.logger.error(`Error creating identity: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to create identity: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
