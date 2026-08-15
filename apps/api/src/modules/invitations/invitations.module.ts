import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';

// BillingModule: el alta de un usuario consume el límite `max_users` del plan, igual que un animal
// consume `max_animals`. Mismo `assertWithinLimit` de siempre.
@Module({
  imports: [BillingModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, MembersService],
})
export class InvitationsModule {}
