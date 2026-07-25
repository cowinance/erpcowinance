import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { NumberingService } from './numbering.service';

/**
 * Fiscal (G4 · facturación electrónica, Venezuela). Hoy: numeración (G4-2). Va a sumar el motor de
 * impuestos (G4-3), los comprobantes (G4-4) y los libros de IVA (G4-5).
 *
 * `NumberingService` se EXPORTA porque quien emite el comprobante toma el número dentro de su
 * propia transacción: si el módulo lo guardara para sí, la asignación tendría que abrir una tx
 * aparte y el número se consumiría aunque el comprobante fallara.
 */
@Module({
  controllers: [TaxController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class TaxModule {}
