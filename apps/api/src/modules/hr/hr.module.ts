import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { PayrollController } from './payroll.controller';
import { EmployeesService } from './employees.service';
import { PayrollService } from './payroll.service';
import { FinanceModule } from '../finance/finance.module';

/**
 * RRHH: empleados (H-1) + liquidaciones (H-2). Depende (unidireccional) de Finanzas para postear el
 * asiento de nómina reusando LedgerService + el mapa de roles de PostingService.
 */
@Module({
  imports: [FinanceModule],
  controllers: [HrController, PayrollController],
  providers: [EmployeesService, PayrollService],
})
export class HrModule {}
