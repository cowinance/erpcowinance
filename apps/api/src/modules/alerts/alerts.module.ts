import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AgendaController } from './agenda.controller';
import { AlertsService } from './alerts.service';

@Module({ controllers: [AlertsController, AgendaController], providers: [AlertsService] })
export class AlertsModule {}
