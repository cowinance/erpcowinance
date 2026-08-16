import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CREDENTIAL_RULES, RateLimit } from '../../common/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit(CREDENTIAL_RULES)
  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body);
  }

  @Public()
  @RateLimit(CREDENTIAL_RULES)
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

  /** Las organizaciones a las que pertenece quien está en sesión, con su rol en cada una. */
  @Get('organizations')
  organizations() {
    return this.auth.organizations();
  }

  /**
   * Cambia de organización sin volver a autenticarse. Emite tokens nuevos.
   *
   * NO es `@Public`: hay que tener una sesión válida para cambiar de finca. Lo que autoriza el
   * cambio es la asignación en la organización de destino, que el servicio revalida.
   */
  @Post('switch')
  switchOrganization(@Body() body: any) {
    return this.auth.switchOrganization(body);
  }
}
