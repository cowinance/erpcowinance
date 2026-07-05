import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthInterceptor } from './auth.interceptor';

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_INTERCEPTOR, useClass: AuthInterceptor }],
})
export class AuthModule {}
