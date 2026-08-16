import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { IdentityModule } from './modules/identity/identity.module';
import { HerdModule } from './modules/herd/herd.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SyncModule } from './modules/sync/sync.module';
import { SyncRegistryModule } from './modules/sync/registry/sync-registry.module';
import { EventBusModule } from './infra/event-bus/event-bus.module';
import { EmailModule } from './infra/email/email.module';
import { StorageModule } from './infra/storage/storage.module';
import { AnimalHistoryModule } from './modules/animal-history/animal-history.module';
import { HealthModule } from './modules/health/health.module';
import { ReproModule } from './modules/repro/repro.module';
import { AuthModule } from './modules/auth/auth.module';
import { LandModule } from './modules/land/land.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { MediaModule } from './modules/media/media.module';
import { ImportModule } from './modules/import/import.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { BillingModule } from './modules/billing/billing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { FinanceModule } from './modules/finance/finance.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { HrModule } from './modules/hr/hr.module';
import { AgricultureModule } from './modules/agriculture/agriculture.module';
import { MachineryModule } from './modules/machinery/machinery.module';
import { GeneticsModule } from './modules/genetics/genetics.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { SlaughterModule } from './modules/slaughter/slaughter.module';
import { GrazingModule } from './modules/grazing/grazing.module';
import { DairyModule } from './modules/dairy/dairy.module';
import { LabModule } from './modules/lab/lab.module';
import { FeedlotModule } from './modules/feedlot/feedlot.module';
import { BreedingModule } from './modules/breeding/breeding.module';
import { CostingModule } from './modules/costing/costing.module';
import { ConfigModule } from './modules/config/config.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OpsModule } from './modules/ops/ops.module';
import { TaxModule } from './modules/tax/tax.module';
import { WeatherModule } from './modules/weather/weather.module';
import { PlatformModule } from './modules/platform/platform.module';
import { InvitationsModule } from './modules/invitations/invitations.module';

/**
 * Monolito modular (ADR-0001): cada módulo se alinea 1:1 con un bounded context, y la extracción
 * futura a microservicios preserva esos límites.
 *
 * **Cómo se comunican los módulos, hoy:** por inyección directa del servicio del otro módulo. Las
 * dependencias apuntan siempre hacia abajo —agregadores → procesos → dominio → plataforma— y
 * `madge` verifica en el gate que no haya un solo ciclo.
 *
 * Acá decía que la comunicación «pasará por el bus de eventos interno». No es lo que pasa ni lo
 * que conviene que pase en general: casi todo lo que un módulo le pide a otro tiene que ser
 * ATÓMICO con la escritura que lo origina —descontar stock en una venta, dejar el hecho en la
 * línea de tiempo del animal— y un bus at-least-once cambiaría esa garantía por consistencia
 * eventual a cambio de desacople. Para esos casos el desacople no vale el precio.
 *
 * El bus (ADR-0005) existe, funciona y está bien construido, pero espera su primer consumidor
 * real: algo cuya demora sea tolerable, cuyo fallo se pueda reintentar, y que NO sea el registro
 * primario de nada. El ADR tiene el criterio y los candidatos ya descartados.
 */
@Module({
  imports: [DbModule, OpsModule, SyncRegistryModule, EventBusModule, EmailModule, StorageModule, AnimalHistoryModule, AuthModule, IdentityModule, HerdModule, DashboardModule, SyncModule, HealthModule, ReproModule, LandModule, ReportsModule, AlertsModule, MediaModule, ImportModule, TasksModule, NotificationsModule, BillingModule, InventoryModule, CommerceModule, FinanceModule, NutritionModule, HrModule, AgricultureModule, MachineryModule, GeneticsModule, TraceabilityModule, SlaughterModule, GrazingModule, DairyModule, LabModule, FeedlotModule, BreedingModule, CostingModule, ConfigModule, DocumentsModule, WeatherModule, TaxModule, PlatformModule, OnboardingModule, InvitationsModule],
})
export class AppModule {}
