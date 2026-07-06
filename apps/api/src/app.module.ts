import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { IdentityModule } from './modules/identity/identity.module';
import { HerdModule } from './modules/herd/herd.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SyncModule } from './modules/sync/sync.module';
import { HealthModule } from './modules/health/health.module';
import { ReproModule } from './modules/repro/repro.module';
import { AuthModule } from './modules/auth/auth.module';
import { LandModule } from './modules/land/land.module';

/**
 * Monolito modular (Fase 0-1 del roadmap): cada módulo se alinea 1:1 con un
 * bounded context. La comunicación entre módulos pasará por el bus de eventos
 * interno; la extracción futura a microservicios preserva estos límites.
 */
@Module({
  imports: [DbModule, AuthModule, IdentityModule, HerdModule, DashboardModule, SyncModule, HealthModule, ReproModule, LandModule],
})
export class AppModule {}
