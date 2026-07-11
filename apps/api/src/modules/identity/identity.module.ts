import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { EmailActionTokenService } from './email-action-token.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, EmailActionTokenService],
})
export class IdentityModule {}
