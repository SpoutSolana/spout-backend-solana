import { Controller, Get } from '@nestjs/common';

@Controller('web3')
export class Web3Controller {
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      module: 'web3',
      timestamp: new Date().toISOString(),
    };
  }
}
