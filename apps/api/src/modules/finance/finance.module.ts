import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { LedgerController } from './ledger.controller';
import { PostingController } from './posting.controller';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { CommerceModule } from '../commerce/commerce.module';

/**
 * Finanzas: libro mayor core (F-1 — plan de cuentas, períodos, centros de costo, asientos de partida
 * doble + sumas y saldos) + asientos automáticos desde documentos (F-2 — PostingService). Depende
 * (unidireccional) de Commerce para leer compras/ventas y sellar su journal_entry_id.
 */
@Module({
  imports: [CommerceModule],
  controllers: [FinanceController, LedgerController, PostingController],
  providers: [AccountsService, LedgerService, PostingService],
  exports: [AccountsService, LedgerService],
})
export class FinanceModule {}
