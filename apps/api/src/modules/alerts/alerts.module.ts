import { Module } from '@nestjs/common';
import { ReproModule } from '../repro/repro.module';
import { WeatherModule } from '../weather/weather.module';
import { GeneticsModule } from '../genetics/genetics.module';
import { AlertsController } from './alerts.controller';
import { AgendaController } from './agenda.controller';
import { AlertsService } from './alerts.service';
import { AlertRulesService } from './alert-rules.service';

// Repro/Weather/Genetics los necesita el MOTOR de reglas, no el ciclo de vida de la alerta:
// desde el split, AlertsService solo depende de la base.
@Module({ imports: [ReproModule, WeatherModule, GeneticsModule], controllers: [AlertsController, AgendaController], providers: [AlertsService, AlertRulesService], exports: [AlertsService] })
export class AlertsModule {}
