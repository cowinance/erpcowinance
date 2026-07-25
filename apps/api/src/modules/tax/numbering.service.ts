import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PADDING,
  FISCAL_DOCUMENT_TYPES,
  InvalidSeriesError,
  SERIES_PURPOSES,
  formatFiscalNumber,
  seriesStatus,
  validateSeries,
  type FiscalDocumentType,
  type SeriesPurpose,
} from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

interface SeriesRow {
  id: string;
  purpose: SeriesPurpose;
  document_type: FiscalDocumentType | null;
  prefix: string | null;
  padding: number;
  next_number: string | number;
  range_from: string | number | null;
  range_to: string | number | null;
}

export interface AllocatedNumber {
  series_id: string;
  number: number;
  formatted: string;
}

/**
 * Numeración fiscal (G4-2) — asignación de los dos correlativos del comprobante venezolano.
 *
 * **Toda la etapa se juega en `allocateInTx`.** El requisito es que el correlativo no tenga huecos,
 * y eso descarta la solución obvia: una `sequence` de PostgreSQL NO vuelve atrás a propósito, así
 * que una emisión que falle después de pedir el número deja el hueco igual — y un hueco en un
 * correlativo fiscal hay que justificarlo ante el SENIAT.
 *
 * Por eso el número se toma con `SELECT … FOR UPDATE` DENTRO de la transacción del comprobante:
 *
 *   · Dos emisiones simultáneas se serializan en esa fila; la segunda espera y ve el número ya
 *     avanzado. Sin el `FOR UPDATE` las dos leerían el mismo y saldrían dos comprobantes con el
 *     mismo número — el peor error posible acá, porque se descubre cuando el cliente presenta dos
 *     facturas iguales.
 *   · Si el comprobante no se guarda, el `UPDATE` del contador vuelve atrás con él y el número
 *     queda disponible. El hueco no se produce.
 *
 * El costo es que la emisión de comprobantes queda serializada por empresa. Es deliberado: a ritmo
 * de finca no se nota, y es el único modo de que «sin huecos» sea verdad y no una intención.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly db: DbService) {}

  private async companyId(): Promise<string> {
    const c = await this.db.one<{ id: string }>(
      `SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [this.db.tenant],
    );
    if (!c) throw new BadRequestException({ code: 'tax.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  /**
   * Toma el próximo número de la serie y la avanza. **Recibe la transacción del comprobante a
   * propósito**: si abriera una propia, el número se consumiría aunque el comprobante fallara, que
   * es justo el hueco que se quiere evitar.
   */
  async allocateInTx(q: Q, purpose: SeriesPurpose, documentType: FiscalDocumentType, companyId: string): Promise<AllocatedNumber> {
    // `control` es UNA serie para todos los tipos (identifica el papel, no el documento); `document`
    // tiene una por tipo. Esa diferencia es la que decide contra qué fila se bloquea.
    const byType = purpose === 'document';
    const s = await q.one<SeriesRow>(
      `SELECT id, purpose, document_type, prefix, padding, next_number, range_from, range_to
         FROM fiscal_series
        WHERE tenant_id=$1 AND company_id=$2 AND purpose=$3
          AND (${byType ? 'document_type=$4' : '$4::text IS NOT NULL AND document_type IS NULL'})
          AND is_active AND deleted_at IS NULL
        FOR UPDATE`,
      [this.db.tenant, companyId, purpose, documentType],
    );
    if (!s)
      throw new BadRequestException({
        code: 'tax.no_series',
        title:
          purpose === 'control'
            ? 'No hay una serie de números de control activa: cargá el lote autorizado por la imprenta'
            : `No hay una serie de numeración activa para ${documentType}`,
      });

    const next = Number(s.next_number);
    const rangeTo = s.range_to == null ? null : Number(s.range_to);
    const estado = seriesStatus(next, rangeTo, s.prefix, s.padding);
    if (estado.health === 'exhausted')
      throw new ConflictException({
        code: 'tax.series_exhausted',
        title: 'Se agotó el lote de formas libres autorizado: pedí el lote nuevo a la imprenta antes de seguir facturando',
      });

    await q.query(`UPDATE fiscal_series SET next_number = next_number + 1, updated_at = now() WHERE id = $1`, [s.id]);
    return { series_id: s.id, number: next, formatted: formatFiscalNumber(s.prefix, next, s.padding) };
  }

  /** Los DOS números que lleva un comprobante, tomados bajo la misma transacción. */
  async allocateForDocumentInTx(q: Q, documentType: FiscalDocumentType, companyId: string) {
    const documento = await this.allocateInTx(q, 'document', documentType, companyId);
    const control = await this.allocateInTx(q, 'control', documentType, companyId);
    return { document_number: documento, control_number: control };
  }

  // ── Administración de series ──────────────────────────────────────────────
  async list() {
    const rows = await this.db.query<SeriesRow & { is_active: boolean; printer_name: string | null; authorization_code: string | null }>(
      `SELECT id, purpose, document_type, prefix, padding, next_number, range_from, range_to,
              is_active, printer_name, authorization_code
         FROM fiscal_series
        WHERE tenant_id=$1 AND deleted_at IS NULL
        ORDER BY purpose, document_type NULLS FIRST`,
      [this.db.tenant],
    );
    // El estado se DERIVA, no se guarda: un `health` en columna se desincroniza con el contador en
    // cuanto se emite un comprobante.
    return rows.map((r) => ({
      ...r,
      next_number: Number(r.next_number),
      range_from: r.range_from == null ? null : Number(r.range_from),
      range_to: r.range_to == null ? null : Number(r.range_to),
      ...seriesStatus(Number(r.next_number), r.range_to == null ? null : Number(r.range_to), r.prefix, r.padding),
    }));
  }

  async create(body: any) {
    const purpose = body?.purpose;
    if (!(SERIES_PURPOSES as readonly string[]).includes(purpose))
      throw new BadRequestException({ code: 'tax.invalid_purpose', title: `purpose inválido (${SERIES_PURPOSES.join('|')})` });

    // El tipo va SOLO en la serie de documento. En `control` sería una contradicción: esa serie es
    // una sola para todos los tipos, y aceptarlo dejaría creíble que hay una por tipo.
    const documentType = purpose === 'document' ? body?.document_type : null;
    if (purpose === 'document' && !(FISCAL_DOCUMENT_TYPES as readonly string[]).includes(documentType))
      throw new BadRequestException({ code: 'tax.invalid_document_type', title: `document_type inválido (${FISCAL_DOCUMENT_TYPES.join('|')})` });
    if (purpose === 'control' && body?.document_type)
      throw new BadRequestException({
        code: 'tax.control_has_no_type',
        title: 'El número de control es una sola serie para todos los tipos de comprobante: no lleva document_type',
      });

    const { padding, next, rangeFrom, rangeTo } = this.resolveDefinition(body, purpose, documentType);
    const companyId = await this.companyId();
    // Sin `q` propio: se corre sobre el pool. Con `q`, participa de la transacción de quien llama —
    // que es lo que `replace` necesita para cerrar una serie y abrir la otra sin dejar un hueco en
    // el medio en el que nadie pueda facturar.
    const id = await this.insertSeries(this.db as any, {
      companyId, purpose, documentType, padding, next, rangeFrom, rangeTo, body,
    });
    return this.get(id);
  }

  /** El INSERT solo, para poder correrlo sobre el pool o dentro de una transacción ajena. */
  private async insertSeries(
    q: Pick<Q, 'one'>,
    a: { companyId: string; purpose: string; documentType: string | null; padding: number; next: number; rangeFrom: number | null; rangeTo: number | null; body: any },
  ): Promise<string> {
    try {
      const row = await q.one<{ id: string }>(
        `INSERT INTO fiscal_series (tenant_id, company_id, purpose, document_type, prefix, padding, next_number,
                                    range_from, range_to, printer_name, printer_tax_id, authorization_code, authorized_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          this.db.tenant, a.companyId, a.purpose, a.documentType, (a.body?.prefix ?? '').trim() || null, a.padding, a.next,
          a.rangeFrom, a.rangeTo, a.body?.printer_name ?? null, a.body?.printer_tax_id ?? null,
          a.body?.authorization_code ?? null, a.body?.authorized_at ?? null, this.db.user,
        ],
      );
      return row!.id;
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('ux_fiscal_series_active'))
        throw new ConflictException({
          code: 'tax.series_already_active',
          title: 'Ya hay una serie activa para ese destino: desactivá la anterior antes de abrir la nueva',
        });
      throw e;
    }
  }

  /** Valida la definición y devuelve los campos ya resueltos. Compartido por `create` y `replace`. */
  private resolveDefinition(body: any, purpose: string, documentType: string | null) {
    const rangeFrom = body?.range_from == null ? null : Number(body.range_from);
    const rangeTo = body?.range_to == null ? null : Number(body.range_to);
    const padding = body?.padding == null ? DEFAULT_PADDING : Number(body.padding);
    const next = body?.next_number == null ? (rangeFrom ?? 1) : Number(body.next_number);
    try {
      validateSeries({ prefix: body?.prefix, padding, rangeFrom, rangeTo, next });
    } catch (e) {
      if (e instanceof InvalidSeriesError) throw new BadRequestException({ code: `tax.invalid_series.${e.problem}`, title: e.message });
      throw e;
    }
    return { purpose, documentType, padding, next, rangeFrom, rangeTo, body };
  }

  async get(id: string) {
    const all = await this.list();
    const s = all.find((x) => x.id === id);
    if (!s) throw new NotFoundException({ code: 'tax.series_not_found', title: 'Serie no encontrada' });
    return s;
  }

  /**
   * Cierra la serie vigente y abre la que la reemplaza, en UNA transacción. Es el momento más
   * delicado de la operación: si se hiciera en dos llamados, entre una y otra no habría serie
   * activa y quien intentara facturar ahí quedaría trabado; y si fallara la segunda, la finca se
   * quedaría sin ninguna. Además el índice único impide tener las dos activas a la vez, así que
   * abrir primero tampoco es una opción.
   */
  async replace(id: string, body: any) {
    const anterior = await this.get(id);
    const def = this.resolveDefinition(body, anterior.purpose, anterior.document_type);
    const companyId = await this.companyId();
    const nuevoId = await this.db.tx(async (q) => {
      await q.query(`UPDATE fiscal_series SET is_active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, this.db.tenant]);
      // Va con el MISMO `q`: el índice único impide las dos activas a la vez, así que el cierre y la
      // apertura tienen que verse como un solo paso o no funcionan.
      return this.insertSeries(q, { ...def, companyId });
    });
    return this.get(nuevoId);
  }
}
