import { Module } from '@nestjs/common';
import { ReproModule } from '../repro/repro.module';
import { WeatherModule } from '../weather/weather.module';
import { AlertsController } from './alerts.controller';
import { AgendaController } from './agenda.controller';
import { AlertsService } from './alerts.service';

@Module({ imports: [ReproModule, WeatherModule], controllers: [AlertsController, AgendaController], providers: [AlertsService], exports: [AlertsService] })
export class AlertsModule {}
