import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { EmployeesService } from './employees.service';

/**
 * RRHH (H-1): maestro de empleados. Bounded context propio. Las liquidaciones (H-2) reusarán
 * LedgerService (Finanzas) para postear el asiento de nómina.
 */
@Module({
  controllers: [HrController],
  providers: [EmployeesService],
})
export class HrModule {}
