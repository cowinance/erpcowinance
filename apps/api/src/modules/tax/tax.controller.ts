import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { VatService } from './vat.service';
import { IssuanceService } from './issuance.service';
import { BooksService } from './books.service';
import { IssuerService } from './issuer.service';

/**
 * Fiscal (G4) — series de numeración (G4-2) y alícuotas de IVA (G4-3).
 *
 * La ASIGNACIÓN de números no se expone: un número fiscal no se pide suelto, se toma dentro de la
 * transacción del comprobante que lo va a usar. Un endpoint para «dame el próximo número» sería
 * precisamente el modo de generar huecos.
 */
@Controller('tax')
export class TaxController {
  constructor(
    private readonly numbering: NumberingService,
    private readonly vat: VatService,
    private readonly issuance: IssuanceService,
    private readonly books: BooksService,
    private readonly issuer: IssuerService,
  ) {}

  /** Series con su estado DERIVADO (cuánto queda del lote, si hay que pedir uno nuevo). */
  @Get('series')
  list() {
    return this.numbering.list();
  }

  @Get('series/:id')
  get(@Param('id') id: string) {
    return this.numbering.get(id);
  }

  @Post('series')
  create(@Body() body: any) {
    return this.numbering.create(body);
  }

  /** Cierra la serie vigente y abre la que la reemplaza, en un solo paso. */
  @Post('series/:id/replace')
  replace(@Param('id') id: string, @Body() body: any) {
    return this.numbering.replace(id, body);
  }

  // ── IVA (G4-3) ────────────────────────────────────────────────────────────
  /** Alícuotas vigentes de la empresa. Son configuración: en Venezuela cambian por providencia. */
  @Get('vat-rates')
  vatRates() {
    return this.vat.rates();
  }

  @Put('vat-rates')
  setVatRates(@Body() body: any) {
    return this.vat.setRates(body);
  }

  /**
   * Desglose de IVA de un conjunto de líneas, sin emitir nada. Existe para que la UI muestre el
   * impuesto con la MISMA regla que va a llevar el comprobante, y no con una cuenta aproximada del
   * frontend que después no coincide con el papel.
   */
  @Post('vat-preview')
  vatPreview(@Body() body: any) {
    return this.vat.preview(body);
  }

  // ── Comprobantes (G4-4) ───────────────────────────────────────────────────
  @Get('documents')
  documents(@Query('from') from?: string, @Query('to') to?: string) {
    return this.issuance.list({ from, to });
  }

  @Get('documents/:id')
  document(@Param('id') id: string) {
    return this.issuance.get(id);
  }

  /** Emite el comprobante de una venta: identidad + los dos números + el IVA, en una transacción. */
  @Post('documents/issue')
  issue(@Body() body: any) {
    return this.issuance.issueFromSale(body);
  }

  /** Anula. NO libera el número: el comprobante sigue ocupando su lugar en el correlativo. */
  @Post('documents/:id/void')
  voidDocument(@Param('id') id: string, @Body() body: any) {
    return this.issuance.voidDocument(id, body);
  }

  // ── Libro de ventas (G4-5) ────────────────────────────────────────────────
  @Get('books/sales')
  salesBook(@Query('from') from?: string, @Query('to') to?: string) {
    return this.books.salesBook({ from, to });
  }

  // ── Identidad fiscal propia (G4-4) ────────────────────────────────────────
  /** Datos fiscales de la empresa que emite. Sin RIF propio no se puede emitir nada. */
  @Get('issuer')
  getIssuer() {
    return this.issuer.get();
  }

  @Put('issuer')
  setIssuer(@Body() body: any) {
    return this.issuer.update(body);
  }
}
