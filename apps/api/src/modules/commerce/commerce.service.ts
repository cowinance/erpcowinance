import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

const PARTNER_TYPES = ['customer', 'supplier', 'both'];
const SUPPLIER_CATEGORIES = ['feed', 'veterinary', 'genetics', 'machinery', 'fuel', 'services', 'other'];
const CUSTOMER_SEGMENTS = ['slaughterhouse', 'dairy', 'auction', 'breeder', 'retail', 'export', 'other'];

/**
 * Comercial — maestro de socios (C-1): business_partners (supertipo) + suppliers/customers (satélites
 * 1:1) + contacts. Un `type` decide qué satélites existen; `both` habilita ambos. Todo por tenant
 * (RLS); baja lógica por `deleted_at`. Sin compras/ventas (C-2/C-3).
 */
@Injectable()
export class CommerceService {
  constructor(private readonly db: DbService) {}

  private companyCache = new Map<string, { id: string; currency: string }>();
  /** Company única del tenant (cadena org→company→farm del registro) + su moneda funcional. */
  private async defaultCompany(): Promise<{ id: string; currency: string }> {
    const t = this.db.tenant;
    const cached = this.companyCache.get(t);
    if (cached) return cached;
    const c = await this.db.one<{ id: string; currency: string }>(
      `SELECT id, functional_currency AS currency FROM companies WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [t],
    );
    if (!c) throw new BadRequestException({ code: 'commerce.no_company', title: 'El tenant no tiene una empresa configurada' });
    this.companyCache.set(t, c);
    return c;
  }

  // ── Socios ───────────────────────────────────────────────────────────────
  /** Lista socios con los campos de sus satélites (supplier/customer) aplanados para la UI. */
  async listPartners(type?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (type && PARTNER_TYPES.includes(type)) {
      params.push(type === 'both' ? 'both' : type);
      // Un socio `both` cuenta como supplier y como customer: se incluye en ambos filtros.
      filter = ` AND (p.type = $${params.length} OR p.type = 'both')`;
    }
    return this.db.query(
      `SELECT p.id, p.type, p.name, p.tax_id, p.email, p.phone, p.credit_limit::float AS credit_limit, p.is_active,
              s.category AS supplier_category, s.payment_terms_days AS supplier_terms,
              c.segment AS customer_segment, c.payment_terms_days AS customer_terms, c.price_list_id
       FROM business_partners p
       LEFT JOIN suppliers s ON s.partner_id = p.id AND s.deleted_at IS NULL
       LEFT JOIN customers c ON c.partner_id = p.id AND c.deleted_at IS NULL
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL${filter}
       ORDER BY p.is_active DESC, p.name`,
      params,
    );
  }

  async getPartner(id: string) {
    const partner = await this.db.one(
      `SELECT p.id, p.type, p.name, p.tax_id, p.email, p.phone, p.address, p.credit_limit::float AS credit_limit, p.is_active,
              s.category AS supplier_category, s.payment_terms_days AS supplier_terms,
              c.segment AS customer_segment, c.payment_terms_days AS customer_terms, c.price_list_id
       FROM business_partners p
       LEFT JOIN suppliers s ON s.partner_id = p.id AND s.deleted_at IS NULL
       LEFT JOIN customers c ON c.partner_id = p.id AND c.deleted_at IS NULL
       WHERE p.id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!partner) throw new NotFoundException({ code: 'commerce.partner_not_found', title: 'Socio no encontrado' });
    const contacts = await this.db.query(
      `SELECT id, name, role, email, phone FROM contacts WHERE partner_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ORDER BY name`,
      [id, this.db.tenant],
    );
    return { ...partner, contacts };
  }

  async createPartner(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'commerce.missing_name', title: 'name es obligatorio' });
    const type = body?.type;
    if (!PARTNER_TYPES.includes(type)) throw new BadRequestException({ code: 'commerce.invalid_type', title: `type inválido (${PARTNER_TYPES.join('|')})` });
    this.validateSatellites(type, body);
    const { id: companyId } = await this.defaultCompany();
    const t = this.db.tenant;

    return this.db.tx(async (q) => {
      const partner = await q.one<{ id: string }>(
        `INSERT INTO business_partners (tenant_id, company_id, type, name, tax_id, email, phone, address, credit_limit, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [t, companyId, type, name, body.tax_id ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.credit_limit ?? null, this.db.user],
      );
      await this.syncSatellites(q, partner!.id, type, body);
      return { id: partner!.id, type, name };
    });
  }

  async updatePartner(id: string, body: any) {
    const t = this.db.tenant;
    const current = await this.db.one<{ id: string; type: string }>(`SELECT id, type FROM business_partners WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!current) throw new NotFoundException({ code: 'commerce.partner_not_found', title: 'Socio no encontrado' });
    const type = body?.type ?? current.type;
    if (!PARTNER_TYPES.includes(type)) throw new BadRequestException({ code: 'commerce.invalid_type', title: `type inválido (${PARTNER_TYPES.join('|')})` });
    this.validateSatellites(type, body);

    const sets: string[] = [];
    const params: unknown[] = [];
    const setField = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) throw new BadRequestException({ code: 'commerce.missing_name', title: 'name no puede ser vacío' });
      setField('name', name);
    }
    if (body?.type !== undefined) setField('type', type);
    for (const f of ['tax_id', 'email', 'phone', 'address', 'credit_limit'] as const) {
      if (body?.[f] !== undefined) setField(f, body[f] ?? null);
    }
    if (typeof body?.is_active === 'boolean') setField('is_active', body.is_active);

    return this.db.tx(async (q) => {
      if (sets.length) {
        params.push(id, t);
        await q.query(`UPDATE business_partners SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`, params);
      }
      await this.syncSatellites(q, id, type, body);
      return { id, type };
    });
  }

  async deletePartner(id: string) {
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const row = await q.one<{ id: string }>(`UPDATE business_partners SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, t]);
      if (!row) throw new NotFoundException({ code: 'commerce.partner_not_found', title: 'Socio no encontrado' });
      await q.query(`UPDATE suppliers SET deleted_at=now() WHERE partner_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
      await q.query(`UPDATE customers SET deleted_at=now() WHERE partner_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
      await q.query(`UPDATE contacts SET deleted_at=now() WHERE partner_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
      return { id, deleted: true };
    });
  }

  /** Valida los enums de los satélites que correspondan al `type`. */
  private validateSatellites(type: string, body: any) {
    if ((type === 'supplier' || type === 'both') && body?.supplier_category != null && !SUPPLIER_CATEGORIES.includes(body.supplier_category)) {
      throw new BadRequestException({ code: 'commerce.invalid_supplier_category', title: `supplier_category inválida (${SUPPLIER_CATEGORIES.join('|')})` });
    }
    if ((type === 'customer' || type === 'both') && body?.customer_segment != null && !CUSTOMER_SEGMENTS.includes(body.customer_segment)) {
      throw new BadRequestException({ code: 'commerce.invalid_customer_segment', title: `customer_segment inválido (${CUSTOMER_SEGMENTS.join('|')})` });
    }
  }

  /**
   * Sincroniza los satélites con el `type`: UPSERT (reactivando si estaba borrado) del lado activo,
   * baja lógica del lado que ya no aplica. Regla única de la relación supertipo/subtipo.
   */
  private async syncSatellites(q: Q, partnerId: string, type: string, body: any) {
    const t = this.db.tenant;
    const wantSupplier = type === 'supplier' || type === 'both';
    const wantCustomer = type === 'customer' || type === 'both';

    // Campo de satélite ausente = sin cambios (COALESCE preserva el valor previo); reactiva si estaba
    // borrado (deleted_at=NULL). Volver a null un campo ya seteado no se soporta por esta vía.
    if (wantSupplier) {
      await q.query(
        `INSERT INTO suppliers (tenant_id, partner_id, category, payment_terms_days, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (partner_id) DO UPDATE SET category=COALESCE(EXCLUDED.category, suppliers.category),
           payment_terms_days=COALESCE(EXCLUDED.payment_terms_days, suppliers.payment_terms_days), deleted_at=NULL, updated_at=now()`,
        [t, partnerId, body?.supplier_category ?? null, body?.supplier_terms ?? null, this.db.user],
      );
    } else {
      await q.query(`UPDATE suppliers SET deleted_at=now() WHERE partner_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [partnerId, t]);
    }

    if (wantCustomer) {
      await q.query(
        `INSERT INTO customers (tenant_id, partner_id, segment, payment_terms_days, price_list_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (partner_id) DO UPDATE SET segment=COALESCE(EXCLUDED.segment, customers.segment),
           payment_terms_days=COALESCE(EXCLUDED.payment_terms_days, customers.payment_terms_days),
           price_list_id=COALESCE(EXCLUDED.price_list_id, customers.price_list_id), deleted_at=NULL, updated_at=now()`,
        [t, partnerId, body?.customer_segment ?? null, body?.customer_terms ?? null, body?.price_list_id ?? null, this.db.user],
      );
    } else {
      await q.query(`UPDATE customers SET deleted_at=now() WHERE partner_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [partnerId, t]);
    }
  }

  // ── Contactos ──────────────────────────────────────────────────────────────
  private async requirePartner(id: string): Promise<void> {
    const p = await this.db.one<{ id: string }>(`SELECT id FROM business_partners WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'commerce.partner_not_found', title: 'Socio no encontrado' });
  }

  async createContact(partnerId: string, body: any) {
    await this.requirePartner(partnerId);
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'commerce.missing_name', title: 'name es obligatorio' });
    return this.db.one(
      `INSERT INTO contacts (tenant_id, partner_id, name, role, email, phone, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, role, email, phone`,
      [this.db.tenant, partnerId, name, body.role ?? null, body.email ?? null, body.phone ?? null, this.db.user],
    );
  }

  async deleteContact(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE contacts SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'commerce.contact_not_found', title: 'Contacto no encontrado' });
    return { id, deleted: true };
  }
}
