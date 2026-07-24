import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CREDENTIAL_RULE, RateLimit } from '../../common/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(CREDENTIAL_RULE)
  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body);
  }

  @Public()
  @RateLimit(CREDENTIAL_RULE)
  @Post('refresh')
  refresh(@Body() body: any) {
    return this.auth.refresh(body);
  }

  @Public()
  @Post('logout')
  logout(@Body() body: any) {
    return this.auth.logout(body);
  }

  @Get('me')
  me() {
    return this.auth.me();
  }
}
