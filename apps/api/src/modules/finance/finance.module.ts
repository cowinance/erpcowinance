import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { LedgerController } from './ledger.controller';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';

/**
 * Finanzas (F-1): libro mayor core — plan de cuentas, períodos, centros de costo (AccountsService) y
 * asientos de partida doble + sumas y saldos (LedgerService). Bounded context propio. Los asientos
 * automáticos desde documentos (F-2) engancharán reusando LedgerService.
 */
@Module({
  controllers: [FinanceController, LedgerController],
  providers: [AccountsService, LedgerService],
  exports: [AccountsService, LedgerService], // F-2: asientos automáticos desde compras/ventas.
})
export class FinanceModule {}
