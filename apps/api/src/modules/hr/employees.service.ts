import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const EMPLOYMENT_TYPES = ['permanent', 'temporary', 'contractor'];

/**
 * RRHH — empleados (H-1): maestro por tenant/company. Baja lógica por `deleted_at`; la TERMINACIÓN
 * laboral (fin de relación) es `termination_date` + `is_active=false` (distinta de la baja del
 * registro). Sobre este maestro se liquidan sueldos (H-2).
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly db: DbService) {}

  private companyCache = new Map<string, string>();
  private async companyId(): Promise<string> {
    const t = this.db.tenant;
    const cached = this.companyCache.get(t);
    if (cached) return cached;
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [t]);
    if (!c) throw new BadRequestException({ code: 'hr.no_company', title: 'El tenant no tiene una empresa configurada' });
    this.companyCache.set(t, c.id);
    return c.id;
  }

  async list(active?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (active === 'true' || active === 'false') {
      params.push(active === 'true');
      filter = ` AND is_active = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, full_name, role, employment_type, hire_date, termination_date, is_active, user_id, hourly_rate::float AS hourly_rate
       FROM employees WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY is_active DESC, full_name`,
      params,
    );
  }

  async get(id: string) {
    const e = await this.db.one(
      `SELECT id, full_name, role, employment_type, hire_date, termination_date, is_active, user_id, hourly_rate::float AS hourly_rate
       FROM employees WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!e) throw new NotFoundException({ code: 'hr.employee_not_found', title: 'Empleado no encontrado' });
    return e;
  }

  async create(body: any) {
    const fullName = String(body?.full_name ?? '').trim();
    if (!fullName) throw new BadRequestException({ code: 'hr.missing_name', title: 'full_name es obligatorio' });
    if (body?.employment_type != null && !EMPLOYMENT_TYPES.includes(body.employment_type)) {
      throw new BadRequestException({ code: 'hr.invalid_employment_type', title: `employment_type inválido (${EMPLOYMENT_TYPES.join('|')})` });
    }
    await this.requireUser(body?.user_id);
    return this.db.one(
      `INSERT INTO employees (tenant_id, company_id, user_id, full_name, role, employment_type, hire_date, hourly_rate, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, full_name, role, employment_type, hire_date, termination_date, is_active, user_id, hourly_rate::float AS hourly_rate`,
      [this.db.tenant, await this.companyId(), body?.user_id ?? null, fullName, body?.role ?? null, body?.employment_type ?? null, body?.hire_date ?? null, this.parseRate(body?.hourly_rate), this.db.user],
    );
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (typeof body?.full_name === 'string') {
      const n = body.full_name.trim();
      if (!n) throw new BadRequestException({ code: 'hr.missing_name', title: 'full_name no puede ser vacío' });
      set('full_name', n);
    }
    if (body?.employment_type !== undefined) {
      if (body.employment_type != null && !EMPLOYMENT_TYPES.includes(body.employment_type)) throw new BadRequestException({ code: 'hr.invalid_employment_type', title: 'employment_type inválido' });
      set('employment_type', body.employment_type ?? null);
    }
    if (body?.user_id !== undefined) {
      await this.requireUser(body.user_id);
      set('user_id', body.user_id ?? null);
    }
    if (body?.hourly_rate !== undefined) set('hourly_rate', this.parseRate(body.hourly_rate));
    for (const f of ['role', 'hire_date'] as const) {
      if (body?.[f] !== undefined) set(f, body[f] ?? null);
    }
    if (!sets.length) throw new BadRequestException({ code: 'hr.no_changes', title: 'Nada para actualizar' });
    return this.persist(id, sets, params);
  }

  /** Terminación laboral: fija termination_date y desactiva (fin de la relación). */
  async terminate(id: string, body: any) {
    const date = body?.termination_date ?? new Date().toISOString().slice(0, 10);
    return this.persist(id, ['termination_date = $1', 'is_active = false'], [date]);
  }

  /** Reactivación: limpia la terminación y reactiva. */
  async reactivate(id: string) {
    return this.persist(id, ['termination_date = NULL', 'is_active = true'], []);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE employees SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'hr.employee_not_found', title: 'Empleado no encontrado' });
    return { id, deleted: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  /**
   * Tarifa horaria (G2 · E6): lo que vale la hora de este empleado, para valorizar sus partes de
   * trabajo. `null` es un estado LEGÍTIMO —todavía no se cargó—; el costeo trata esas horas como
   * «sin valorizar» en vez de contarlas como gratis. Negativa no: no existe la hora que da plata.
   */
  private parseRate(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException({ code: 'hr.invalid_hourly_rate', title: 'hourly_rate debe ser un número ≥ 0' });
    return n;
  }

  private async requireUser(userId: string | null | undefined) {
    if (!userId) return;
    const u = await this.db.one<{ id: string }>(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId]);
    if (!u) throw new NotFoundException({ code: 'hr.user_not_found', title: 'Usuario no encontrado' });
  }

  private async persist(id: string, sets: string[], params: unknown[]) {
    params.push(id, this.db.tenant);
    const row = await this.db.one(
      `UPDATE employees SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, full_name, role, employment_type, hire_date, termination_date, is_active, user_id, hourly_rate::float AS hourly_rate`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'hr.employee_not_found', title: 'Empleado no encontrado' });
    return row;
  }
}
