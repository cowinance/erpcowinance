import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthInterceptor } from './auth.interceptor';
import { RateLimitGuard } from '../../common/rate-limit.guard';

/**
 * El guard de rate limit se registra global (los guards corren ANTES que los interceptores, o sea
 * antes de abrir la transacción y de verificar el token) pero solo actúa donde el handler lleva
 * `@RateLimit`. Uno solo para toda la app: un contador por instancia, no uno por controlador.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthInterceptor },
  ],
  exports: [AuthService],
})
export class AuthModule {}
