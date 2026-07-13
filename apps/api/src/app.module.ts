import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { IdentityModule } from './modules/identity/identity.module';
import { HerdModule } from './modules/herd/herd.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SyncModule } from './modules/sync/sync.module';
import { SyncRegistryModule } from './modules/sync/registry/sync-registry.module';
import { EventBusModule } from './infra/event-bus/event-bus.module';
import { EmailModule } from './infra/email/email.module';
import { AnimalHistoryModule } from './modules/animal-history/animal-history.module';
import { HealthModule } from './modules/health/health.module';
import { ReproModule } from './modules/repro/repro.module';
import { AuthModule } from './modules/auth/auth.module';
import { LandModule } from './modules/land/land.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { MediaModule } from './modules/media/media.module';
import { ImportModule } from './modules/import/import.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { BillingModule } from './modules/billing/billing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

/**
 * Monolito modular (Fase 0-1 del roadmap): cada módulo se alinea 1:1 con un
 * bounded context. La comunicación entre módulos pasará por el bus de eventos
 * interno; la extracción futura a microservicios preserva estos límites.
 */
@Module({
  imports: [DbModule, SyncRegistryModule, EventBusModule, EmailModule, AnimalHistoryModule, AuthModule, IdentityModule, HerdModule, DashboardModule, SyncModule, HealthModule, ReproModule, LandModule, ReportsModule, AlertsModule, MediaModule, ImportModule, TasksModule, NotificationsModule, BillingModule, InventoryModule, CommerceModule],
})
export class AppModule {}
