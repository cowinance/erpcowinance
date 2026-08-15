import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';

/**
 * Alta y baja de usuarios de la finca (capacidad `usuarios`).
 *
 * Las dos rutas `@Public` son las que abre quien RECIBE el email y todavía no tiene cuenta: no
 * puede haber sesión que autorizar. Lo que las protege es el token —256 bits de entropía, guardado
 * hasheado, de un solo uso y con vencimiento—, igual que la verificación de email y el reset de
 * contraseña. Ver `invitation-token.ts` para por qué además lleva el tenant adelante.
 *
 * `preview` es un POST aunque no modifique nada, siguiendo a `verify-email` y `reset-password`:
 * el token va en el CUERPO y no en la query. Un secreto en la URL queda en los logs de acceso del
 * servidor, en el historial del navegador y en el `Referer` de cualquier recurso que cargue la
 * página siguiente.
 */
@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly members: MembersService,
  ) {}

  @Post('invitations')
  create(@Body() body: any) {
    return this.invitations.create(body);
  }

  @Get('invitations')
  list() {
    return this.invitations.list();
  }

  @Delete('invitations/:id')
  revoke(@Param('id') id: string) {
    return this.invitations.revoke(id);
  }

  /** Qué dice la invitación, sin consumirla: la pantalla la muestra antes de pedir la contraseña. */
  @Public()
  @Post('invitations/preview')
  preview(@Body() body: any) {
    return this.invitations.preview(body?.token ?? '');
  }

  @Public()
  @Post('invitations/accept')
  accept(@Body() body: any) {
    return this.invitations.accept(body);
  }

  @Get('members')
  listMembers() {
    return this.members.list();
  }

  @Delete('members/:userId')
  revokeMember(@Param('userId') userId: string) {
    return this.members.revoke(userId);
  }
}
