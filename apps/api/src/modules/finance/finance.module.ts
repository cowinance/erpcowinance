import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { LedgerController } from './ledger.controller';
import { PostingController } from './posting.controller';
import { InvoicesController } from './invoices.controller';
import { PaymentsController } from './payments.controller';
import { BudgetsController } from './budgets.controller';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { BudgetsService } from './budgets.service';
import { CommerceModule } from '../commerce/commerce.module';

/**
 * Finanzas: libro mayor core (F-1 — plan de cuentas, períodos, centros de costo, asientos de partida
 * doble + sumas y saldos) + asientos automáticos desde documentos (F-2 — PostingService). Depende
 * (unidireccional) de Commerce para leer compras/ventas y sellar su journal_entry_id.
 */
@Module({
  imports: [CommerceModule],
  controllers: [FinanceController, LedgerController, PostingController, InvoicesController, PaymentsController, BudgetsController],
  providers: [AccountsService, LedgerService, PostingService, InvoicesService, PaymentsService, BudgetsService],
  exports: [AccountsService, LedgerService, PostingService], // HR (H-2) reusa el mapa de posteo + el mayor.
})
export class FinanceModule {}
