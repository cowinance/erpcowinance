import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';

/** Comercial (C-1): maestro de socios (partners + suppliers/customers + contacts). Bounded context propio. */
@Module({
  controllers: [CommerceController],
  providers: [CommerceService],
})
export class CommerceModule {}
