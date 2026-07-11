import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { EmailActionTokenService } from './email-action-token.service';
import { AuthModule } from '../auth/auth.module';

/**
 * `identity` importa `auth` (dependencia dirigida identity → auth, ADR-0011
 * decisión F) solo para invalidar sesiones al resetear la contraseña. `auth`
 * NO depende de `identity` — no hay ciclo. identity sigue sin emitir tokens.
 */
@Module({
  imports: [AuthModule],
  controllers: [IdentityController],
  providers: [IdentityService, EmailActionTokenService],
})
export class IdentityModule {}
