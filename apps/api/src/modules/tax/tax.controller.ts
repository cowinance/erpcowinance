import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/**
 * Fiscal (G4) — administración de las series de numeración. La ASIGNACIÓN no se expone: un número
 * fiscal no se pide suelto, se toma dentro de la transacción del comprobante que lo va a usar. Un
 * endpoint para «dame el próximo número» sería precisamente el modo de generar huecos.
 */
@Controller('tax')
export class TaxController {
  constructor(private readonly numbering: NumberingService) {}

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
}
