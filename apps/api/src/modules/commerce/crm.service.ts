import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addFarmDays,
  InvalidStageTransitionError,
  type ContractStatus,
  type OpportunityStage,
  assertStageTransition,
  contractStanding,
  isTerminal,
  summarizeContracts,
  summarizePipeline,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * CRM (F3) — la relación con el tercero, sobre la base de socios que ya existe (C-1).
 *
 * Vive dentro del módulo `commerce` a propósito: comparte `business_partners` con Compras y Ventas,
 * y separarlo en otro módulo obligaría a que dos servicios escriban sobre la misma tabla maestra.
 * Lo que agrega F3 es el SEGUIMIENTO: con quién se habló, qué se acordó, qué está en curso y qué
 * contrato vence.
 *
 * Las reglas —etapas válidas, ponderación del pipeline, vigencia de contratos— viven en
 * `@cowinance/domain`; acá solo hay persistencia y composición.
 */
/** Tipos de interacción que el módulo entiende (mismo conjunto que el CHECK de la tabla). */
const INTERACTION_KINDS = ['call', 'visit', 'email', 'whatsapp', 'meeting', 'note'] as const;

@Injectable()
export class CrmService {
  constructor(private readonly db: DbService) {}

  /** Hoy en la finca, no en UTC: después de las 20:00 en Venezuela no son el mismo día. */
  private async hoy(): Promise<string> {
    return this.db.today();
  }

  private async assertPartner(partnerId: string): Promise<string> {
    const p = await this.db.one<{ id: string }>(
      `SELECT id FROM business_partners WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [partnerId || '00000000-0000-0000-0000-000000000000', this.db.tenant],
    );
    if (!p) throw new NotFoundException({ code: 'crm.partner_not_found', title: 'Socio comercial no encontrado' });
    return p.id;
  }

  // ── Contactos ─────────────────────────────────────────────────────────────

  async contacts(partnerId: string) {
    await this.assertPartner(partnerId);
    return this.db.query(
      `SELECT id, name, role, email, phone, created_at FROM contacts
       WHERE tenant_id = $1 AND partner_id = $2 AND deleted_at IS NULL ORDER BY name`,
      [this.db.tenant, partnerId],
    );
  }

  async addContact(partnerId: string, body: { name?: string; role?: string; email?: string; phone?: string }) {
    await this.assertPartner(partnerId);
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'crm.missing_name', title: 'El nombre del contacto es obligatorio' });
    return this.db.one(
      `INSERT INTO contacts (tenant_id, partner_id, name, role, email, phone, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, role, email, phone`,
      [this.db.tenant, partnerId, name, body.role?.trim() || null, body.email?.trim() || null, body.phone?.trim() || null, this.db.user],
    );
  }

  async removeContact(contactId: string) {
    const row = await this.db.one(
      `UPDATE contacts SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [contactId, this.db.tenant],
    );
    if (!row) throw new NotFoundException({ code: 'crm.contact_not_found', title: 'Contacto no encontrado' });
    return { ok: true };
  }

  // ── Interacciones ─────────────────────────────────────────────────────────

  async interactions(params: { partnerId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);
    return this.db.query(
      `SELECT i.id, i.partner_id, bp.name AS partner_name, i.contact_id, c.name AS contact_name,
              i.kind, i.occurred_at, i.summary, i.next_action, i.next_action_at::text, u.full_name AS actor
       FROM partner_interactions i
       JOIN business_partners bp ON bp.id = i.partner_id
       LEFT JOIN contacts c ON c.id = i.contact_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         AND ($2::uuid IS NULL OR i.partner_id = $2::uuid)
       ORDER BY i.occurred_at DESC LIMIT $3`,
      [this.db.tenant, params.partnerId ?? null, limit],
    );
  }

  async logInteraction(body: {
    partner_id?: string;
    contact_id?: string;
    kind?: string;
    summary?: string;
    occurred_at?: string;
    next_action?: string;
    next_action_at?: string;
  }) {
    const partnerId = await this.assertPartner(String(body?.partner_id ?? ''));
    const kind = String(body?.kind ?? 'note').trim();
    if (!INTERACTION_KINDS.includes(kind as never))
      throw new BadRequestException({
        code: 'crm.invalid_kind',
        title: `Tipo de interacción inválido: ${kind}. Válidos: ${INTERACTION_KINDS.join(', ')}`,
      });
    const summary = String(body?.summary ?? '').trim();
    if (!summary)
      throw new BadRequestException({ code: 'crm.missing_summary', title: 'Contá qué se habló: el resumen es obligatorio' });

    // El contacto, si viene, tiene que ser DEL socio: registrar una llamada al contacto de otro
    // cliente es un dato corrupto que después nadie encuentra.
    if (body.contact_id) {
      const c = await this.db.one(
        `SELECT id FROM contacts WHERE id = $1 AND partner_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
        [body.contact_id, partnerId, this.db.tenant],
      );
      if (!c) throw new BadRequestException({ code: 'crm.contact_mismatch', title: 'El contacto no pertenece a ese socio' });
    }

    return this.db.one(
      `INSERT INTO partner_interactions (tenant_id, partner_id, contact_id, kind, summary, occurred_at, next_action, next_action_at, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7,$8::date,$9)
       RETURNING id, kind, occurred_at, summary, next_action, next_action_at::text`,
      [
        this.db.tenant,
        partnerId,
        body.contact_id ?? null,
        kind,
        summary,
        body.occurred_at ?? null,
        body.next_action?.trim() || null,
        body.next_action_at ?? null,
        this.db.user,
      ],
    );
  }

  /**
   * Seguimientos con fecha: lo que convierte el historial en una agenda comercial.
   *
   * Las columnas `date` van con `::text`. El driver las devuelve como `Date` y al serializar salen
   * como `2026-07-27T00:00:00.000Z`: una marca de tiempo con zona horaria para algo que es un día
   * del calendario. Además de verse mal, invita a que el cliente le aplique una zona y muestre el
   * día anterior.
   */
  async followUps(params: { until?: string } = {}) {
    const until = params.until ?? addFarmDays(await this.hoy(), 7);
    return this.db.query(
      `SELECT i.id, i.partner_id, bp.name AS partner_name, i.next_action, i.next_action_at::text, i.summary
       FROM partner_interactions i
       JOIN business_partners bp ON bp.id = i.partner_id
       WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         AND i.next_action_at IS NOT NULL AND i.next_action_at <= $2::date
       ORDER BY i.next_action_at`,
      [this.db.tenant, until],
    );
  }

  // ── Oportunidades ─────────────────────────────────────────────────────────

  async opportunities(params: { stage?: string; partnerId?: string; open?: boolean } = {}) {
    return this.db.query(
      `SELECT o.id, o.partner_id, bp.name AS partner_name, bp.segment, o.title, o.description, o.stage,
              o.expected_value::float AS expected_value, o.currency, o.expected_close_date::text, o.source,
              o.lost_reason, o.closed_at, o.sale_id, o.created_at, o.updated_at
       FROM opportunities o
       JOIN business_partners bp ON bp.id = o.partner_id
       WHERE o.tenant_id = $1 AND o.deleted_at IS NULL
         AND ($2::text IS NULL OR o.stage = $2::text)
         AND ($3::uuid IS NULL OR o.partner_id = $3::uuid)
         AND ($4::boolean IS NOT TRUE OR o.stage NOT IN ('won','lost'))
       ORDER BY o.expected_close_date NULLS LAST, o.created_at DESC`,
      [this.db.tenant, params.stage ?? null, params.partnerId ?? null, params.open ?? null],
    );
  }

  async createOpportunity(body: {
    partner_id?: string;
    title?: string;
    description?: string;
    expected_value?: unknown;
    currency?: string;
    expected_close_date?: string;
    source?: string;
  }) {
    const partnerId = await this.assertPartner(String(body?.partner_id ?? ''));
    const title = String(body?.title ?? '').trim();
    if (!title) throw new BadRequestException({ code: 'crm.missing_title', title: 'La oportunidad necesita un título' });

    const value = this.parseValue(body?.expected_value);

    return this.db.tx(async (q) => {
      const row = await q.one<{ id: string; stage: string }>(
        `INSERT INTO opportunities (tenant_id, partner_id, title, description, expected_value, currency, expected_close_date, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9) RETURNING id, stage, title, expected_value::float AS expected_value`,
        [
          this.db.tenant,
          partnerId,
          title,
          body.description?.trim() || null,
          value,
          body.currency?.trim() || null,
          body.expected_close_date || null,
          body.source?.trim() || null,
          this.db.user,
        ],
      );
      await q.query(
        `INSERT INTO opportunity_stage_events (tenant_id, opportunity_id, from_stage, to_stage, actor_user_id)
         VALUES ($1,$2,NULL,'lead',$3)`,
        [this.db.tenant, row!.id, this.db.user],
      );
      return row;
    });
  }

  /**
   * Mueve la oportunidad de etapa y deja rastro. El historial no es decorativo: sin él no se puede
   * responder cuánto tarda una oportunidad en cerrarse, porque la etapa actual pisa a la anterior.
   */
  async moveStage(id: string, body: { stage?: string; note?: string; lost_reason?: string; sale_id?: string }) {
    const opp = await this.db.one<{ id: string; stage: OpportunityStage }>(
      `SELECT id, stage FROM opportunities WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!opp) throw new NotFoundException({ code: 'crm.opportunity_not_found', title: 'Oportunidad no encontrada' });

    const to = String(body?.stage ?? '').trim() as OpportunityStage;
    try {
      assertStageTransition(opp.stage, to);
    } catch (e) {
      if (e instanceof InvalidStageTransitionError)
        throw new BadRequestException({ code: 'crm.invalid_stage', title: e.reason });
      throw e;
    }

    // Perder sin motivo deja un pipeline que no enseña nada: el próximo trimestre nadie sabe por
    // qué se cayeron las ventas.
    if (to === 'lost' && !String(body?.lost_reason ?? '').trim())
      throw new BadRequestException({ code: 'crm.missing_lost_reason', title: 'Indicá por qué se perdió' });

    // La venta enlazada tiene que existir y ser del mismo socio: es la trazabilidad que pide el
    // catálogo entre CRM y Ventas.
    if (body.sale_id) {
      // `sales` llama al socio `customer_partner_id`, no `partner_id`: en Ventas el tercero es
      // siempre el comprador, mientras que en CRM puede ser cliente o proveedor.
      const sale = await this.db.one(
        `SELECT s.id FROM sales s
         JOIN opportunities o ON o.partner_id = s.customer_partner_id
         WHERE s.id = $1 AND o.id = $2 AND s.tenant_id = $3 AND s.deleted_at IS NULL`,
        [body.sale_id, id, this.db.tenant],
      );
      if (!sale)
        throw new BadRequestException({ code: 'crm.sale_mismatch', title: 'La venta no existe o es de otro socio' });
    }

    return this.db.tx(async (q) => {
      const row = await q.one(
        // Los `$2::text` explícitos no son adorno: sin ellos Postgres intenta deducir el tipo del
        // parámetro desde tres usos distintos (asignación, IN, comparación) y falla con
        // «inconsistent types deduced for parameter $2».
        `UPDATE opportunities
         SET stage = $2::text, updated_at = now(),
             closed_at = CASE WHEN $2::text IN ('won','lost') THEN now() ELSE NULL END,
             lost_reason = CASE WHEN $2::text = 'lost' THEN $3::text ELSE NULL END,
             sale_id = COALESCE($4::uuid, sale_id)
         WHERE id = $1 RETURNING id, stage, closed_at, lost_reason, sale_id`,
        [id, to, body.lost_reason?.trim() || null, body.sale_id ?? null],
      );
      await q.query(
        `INSERT INTO opportunity_stage_events (tenant_id, opportunity_id, from_stage, to_stage, note, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [this.db.tenant, id, opp.stage, to, body.note?.trim() || null, this.db.user],
      );
      return row;
    });
  }

  async opportunityHistory(id: string) {
    return this.db.query(
      `SELECT e.from_stage, e.to_stage, e.note, e.occurred_at, u.full_name AS actor
       FROM opportunity_stage_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.tenant_id = $1 AND e.opportunity_id = $2 ORDER BY e.occurred_at`,
      [this.db.tenant, id],
    );
  }

  // ── Contratos ─────────────────────────────────────────────────────────────

  async contracts(params: { partnerId?: string; expiryWindowDays?: number } = {}) {
    const rows = await this.db.query<any>(
      `SELECT c.id, c.partner_id, bp.name AS partner_name, c.type, c.start_date::text, c.end_date::text,
              c.status, c.value::float AS value, c.terms, c.document_id
       FROM contracts c
       JOIN business_partners bp ON bp.id = c.partner_id
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
         AND ($2::uuid IS NULL OR c.partner_id = $2::uuid)
       ORDER BY c.end_date NULLS LAST, c.start_date DESC`,
      [this.db.tenant, params.partnerId ?? null],
    );
    const hoy = await this.hoy();
    return rows.map((c) => ({ ...c, standing: contractStanding(c, hoy, params.expiryWindowDays) }));
  }

  async createContract(body: {
    partner_id?: string;
    type?: string;
    start_date?: string;
    end_date?: string;
    value?: unknown;
    terms?: string;
    status?: string;
  }) {
    const partnerId = await this.assertPartner(String(body?.partner_id ?? ''));
    const type = String(body?.type ?? '').trim();
    if (!type) throw new BadRequestException({ code: 'crm.missing_type', title: 'Indicá el tipo de contrato' });
    const start = String(body?.start_date ?? '').trim();
    if (!start) throw new BadRequestException({ code: 'crm.missing_start', title: 'La fecha de inicio es obligatoria' });
    const end = body?.end_date?.trim() || null;
    // Un contrato que termina antes de empezar no es un error de tipeo tolerable: rompe la vigencia
    // y el indicador de cartera.
    if (end && end < start)
      throw new BadRequestException({ code: 'crm.invalid_range', title: 'El contrato termina antes de empezar' });

    const company = await this.db.one<{ id: string }>(
      `SELECT company_id AS id FROM business_partners WHERE id = $1 AND tenant_id = $2`,
      [partnerId, this.db.tenant],
    );

    return this.db.one(
      `INSERT INTO contracts (tenant_id, company_id, partner_id, type, start_date, end_date, value, terms, status, created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10)
       RETURNING id, type, start_date::text, end_date::text, status, value::float AS value`,
      [
        this.db.tenant,
        company!.id,
        partnerId,
        type,
        start,
        end,
        this.parseValue(body?.value),
        body.terms?.trim() || null,
        (body.status as ContractStatus) || 'active',
        this.db.user,
      ],
    );
  }

  async setContractStatus(id: string, status: string) {
    if (!['draft', 'active', 'expired', 'terminated'].includes(status))
      throw new BadRequestException({ code: 'crm.invalid_status', title: `Estado inválido: ${status}` });
    const row = await this.db.one(
      `UPDATE contracts SET status = $2, updated_at = now()
       WHERE id = $1 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id, status`,
      [id, status, this.db.tenant],
    );
    if (!row) throw new NotFoundException({ code: 'crm.contract_not_found', title: 'Contrato no encontrado' });
    return row;
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  /** Los cuatro indicadores del catálogo: clientes activos, oportunidades abiertas, contratos por vencer y cartera. */
  async summary(params: { expiryWindowDays?: number } = {}) {
    const [opps, contratos, clientes, seguimientos] = await Promise.all([
      this.db.query<{ stage: OpportunityStage; value: number | null }>(
        `SELECT stage, expected_value::float AS value FROM opportunities
         WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [this.db.tenant],
      ),
      this.contracts({ expiryWindowDays: params.expiryWindowDays }),
      this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM business_partners
         WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active AND type IN ('customer','both')`,
        [this.db.tenant],
      ),
      this.followUps(),
    ]);

    return {
      pipeline: summarizePipeline(opps),
      contracts: summarizeContracts(contratos, await this.hoy(), params.expiryWindowDays),
      activeCustomers: clientes?.n ?? 0,
      pendingFollowUps: seguimientos.length,
    };
  }

  /** Segmentación (frigorífico, tambo, remate, exportación…): texto libre acotado, no un catálogo cerrado. */
  async setSegment(partnerId: string, segment: string | null) {
    await this.assertPartner(partnerId);
    const value = segment?.trim().slice(0, 32) || null;
    return this.db.one(
      `UPDATE business_partners SET segment = $2, updated_at = now() WHERE id = $1 AND tenant_id = $3
       RETURNING id, name, segment`,
      [partnerId, value, this.db.tenant],
    );
  }

  /** `null` cuando todavía no se sabe; se rechaza lo que no es un número o es negativo. */
  private parseValue(raw: unknown): number | null {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
      throw new BadRequestException({ code: 'crm.invalid_value', title: `Valor inválido: ${raw}` });
    return n;
  }
}

/** Reexportado para el controlador y los tests. */
export { isTerminal };
