import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { NumberingService } from './numbering.service';
import { VatService } from './vat.service';

/**
 * Fiscal (G4 · facturación electrónica, Venezuela). Hoy: numeración (G4-2) e IVA (G4-3). Va a sumar los
 * comprobantes (G4-4) y los libros de IVA (G4-5). Todo en USD: por decisión del productor no hay
 * bolívares ni conversión de moneda en ninguna parte del módulo.
 *
 * `NumberingService` se EXPORTA porque quien emite el comprobante toma el número dentro de su
 * propia transacción: si el módulo lo guardara para sí, la asignación tendría que abrir una tx
 * aparte y el número se consumiría aunque el comprobante fallara.
 */
@Module({
  controllers: [TaxController],
  providers: [NumberingService, VatService],
  exports: [NumberingService, VatService],
})
export class TaxModule {}
