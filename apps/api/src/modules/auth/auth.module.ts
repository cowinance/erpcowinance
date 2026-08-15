import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthInterceptor } from './auth.interceptor';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { PermissionsInterceptor } from '../../common/permissions/permissions.interceptor';

/**
 * El guard de rate limit se registra global (los guards corren ANTES que los interceptores, o sea
 * antes de abrir la transacción y de verificar el token) pero solo actúa donde el handler lleva
 * `@RateLimit`. Uno solo para toda la app: un contador por instancia, no uno por controlador.
 *
 * EL ORDEN DE LOS INTERCEPTORES IMPORTA Y NO ES DECORATIVO: `PermissionsInterceptor` va DESPUÉS de
 * `AuthInterceptor` porque autoriza contra el rol que aquel deja en el `requestContext`. Invertirlos
 * no rompe ninguna prueba de forma obvia —la app sigue respondiendo— pero deja de autorizar: cada
 * request llegaría sin contexto. Por eso hay un test que verifica esta posición.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PermissionsInterceptor },
  ],
  exports: [AuthService],
})
export class AuthModule {}
