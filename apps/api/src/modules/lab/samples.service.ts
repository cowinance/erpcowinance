import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';

const SAMPLE_TYPES = ['blood', 'tissue', 'milk', 'soil', 'hair', 'semen', 'feces', 'other'];
const STATUSES = ['collected', 'sent', 'in_progress', 'completed', 'rejected'];
/** Máquina de estados de una muestra. `rejected` y `completed` son terminales. */
const TRANSITIONS: Record<string, string[]> = {
  collected: ['sent', 'rejected'],
  sent: ['in_progress', 'completed', 'rejected'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};
/** Solo se pueden cargar resultados de una muestra que ya salió al laboratorio. */
const RESULTABLE = ['sent', 'in_progress', 'completed'];

/**
 * Laboratorio (LAB-1/LAB-2) — muestras y sus resultados. Una muestra tiene un tipo, se toma de un
 * animal O un potrero (ambos opcionales), y avanza collected→sent→in_progress→completed/rejected
 * (regla única `TRANSITIONS`, 409 en transición inválida, idempotente). Los resultados (LAB-2) se
 * cargan sobre una muestra ya enviada. `is_open` y los conteos de resultados son DERIVADOS.
 */
@Injectable()
export class SamplesService {
  constructor(private readonly db: DbService) {}

  private readonly cols = `s.id, s.lab_id, l.name AS lab_name, s.sample_type, s.animal_id, tag.value AS animal_tag,
     s.paddock_id, p.name AS paddock_name, s.collected_at, s.sent_at, s.status, s.barcode,
     (s.status NOT IN ('completed','rejected')) AS is_open,
     (SELECT count(*)::int FROM lab_results r WHERE r.sample_id = s.id AND r.deleted_at IS NULL) AS result_count,
     (SELECT count(*)::int FROM lab_results r WHERE r.sample_id = s.id AND r.deleted_at IS NULL AND r.is_abnormal) AS abnormal_count`;

  private readonly from = `FROM lab_samples s
     LEFT JOIN labs l ON l.id = s.lab_id
     LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = s.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
     LEFT JOIN paddocks p ON p.id = s.paddock_id`;

  async list(filters: { status?: string; animal_id?: string; paddock_id?: string; lab_id?: string }) {
    const params: unknown[] = [this.db.tenant];
    let where = '';
    const add = (val: unknown, clause: (n: number) => string) => {
      params.push(val);
      where += ` AND ${clause(params.length)}`;
    };
    if (filters.status && STATUSES.includes(filters.status)) add(filters.status, (n) => `s.status = $${n}`);
    if (filters.animal_id) add(filters.animal_id, (n) => `s.animal_id = $${n}`);
    if (filters.paddock_id) add(filters.paddock_id, (n) => `s.paddock_id = $${n}`);
    if (filters.lab_id) add(filters.lab_id, (n) => `s.lab_id = $${n}`);
    return this.db.query(
      `SELECT ${this.cols} ${this.from} WHERE s.tenant_id=$1 AND s.deleted_at IS NULL${where} ORDER BY s.collected_at DESC, s.created_at DESC LIMIT 300`,
      params,
    );
  }

  async get(id: string) {
    const s = await this.db.one(`SELECT ${this.cols} ${this.from} WHERE s.id=$1 AND s.tenant_id=$2 AND s.deleted_at IS NULL`, [id, this.db.tenant]);
    if (!s) throw new NotFoundException({ code: 'lab.sample_not_found', title: 'Muestra no encontrada' });
    return s;
  }

  async create(body: any) {
    const sampleType = String(body?.sample_type ?? '');
    if (!SAMPLE_TYPES.includes(sampleType)) throw new BadRequestException({ code: 'lab.invalid_sample_type', title: `sample_type inválido (${SAMPLE_TYPES.join('|')})` });
    await this.requireLab(body?.lab_id);
    await this.requireAnimal(body?.animal_id);
    await this.requirePaddock(body?.paddock_id);
    const collectedAt = body?.collected_at ?? new Date().toISOString();
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO lab_samples (tenant_id, lab_id, sample_type, animal_id, paddock_id, collected_at, barcode, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'collected',$8) RETURNING id`,
      [this.db.tenant, body?.lab_id ?? null, sampleType, body?.animal_id ?? null, body?.paddock_id ?? null, collectedAt, body?.barcode ?? null, this.db.user],
    );
    return this.get((row as { id: string }).id);
  }

  /** Transición de estado (regla única). Idempotente en el mismo estado; 409 si la transición no es válida. */
  async setStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'lab.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const s = await this.db.one<{ status: string }>(`SELECT status FROM lab_samples WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!s) throw new NotFoundException({ code: 'lab.sample_not_found', title: 'Muestra no encontrada' });
    if (s.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[s.status]?.includes(next)) throw new ConflictException({ code: 'lab.invalid_transition', title: `No se puede pasar de '${s.status}' a '${next}'` });
    // Al salir (→ sent) sella la fecha de envío si no estaba.
    const sentAt = next === 'sent' ? ', sent_at = COALESCE(sent_at, now())' : '';
    await this.db.query(`UPDATE lab_samples SET status=$1${sentAt}, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, this.db.tenant]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE lab_samples SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'lab.sample_not_found', title: 'Muestra no encontrada' });
    return { id, deleted: true };
  }

  // ── Resultados (LAB-2) ─────────────────────────────────────────────────────
  async listResults(sampleId: string) {
    await this.get(sampleId); // valida pertenencia al tenant
    return this.db.query(
      `SELECT id, test_code, result_value, result_data, reference_range, is_abnormal, reported_at
       FROM lab_results WHERE sample_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY reported_at DESC NULLS LAST, created_at DESC`,
      [sampleId, this.db.tenant],
    );
  }

  async addResult(sampleId: string, body: any) {
    const s = await this.db.one<{ status: string }>(`SELECT status FROM lab_samples WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [sampleId, this.db.tenant]);
    if (!s) throw new NotFoundException({ code: 'lab.sample_not_found', title: 'Muestra no encontrada' });
    if (!RESULTABLE.includes(s.status)) throw new ConflictException({ code: 'lab.sample_not_resultable', title: `No se pueden cargar resultados de una muestra '${s.status}' (enviala primero)` });
    const testCode = String(body?.test_code ?? '').trim();
    if (!testCode) throw new BadRequestException({ code: 'lab.missing_test_code', title: 'test_code es obligatorio' });
    const reportedAt = body?.reported_at ?? new Date().toISOString();
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO lab_results (tenant_id, sample_id, test_code, result_value, result_data, reference_range, is_abnormal, reported_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [this.db.tenant, sampleId, testCode, body?.result_value ?? null, body?.result_data ?? {}, body?.reference_range ?? null, body?.is_abnormal ?? null, reportedAt, this.db.user],
    );
    return this.db.one(
      `SELECT id, test_code, result_value, result_data, reference_range, is_abnormal, reported_at FROM lab_results WHERE id=$1 AND tenant_id=$2`,
      [(row as { id: string }).id, this.db.tenant],
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async requireLab(id: string | null | undefined) {
    if (!id) return;
    const l = await this.db.one<{ id: string }>(`SELECT id FROM labs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!l) throw new NotFoundException({ code: 'lab.lab_not_found', title: 'Laboratorio no encontrado' });
  }

  private async requireAnimal(id: string | null | undefined) {
    if (!id) return;
    const a = await this.db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!a) throw new NotFoundException({ code: 'lab.animal_not_found', title: 'Animal no encontrado' });
  }

  private async requirePaddock(id: string | null | undefined) {
    if (!id) return;
    const p = await this.db.one<{ id: string }>(`SELECT id FROM paddocks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!p) throw new NotFoundException({ code: 'lab.paddock_not_found', title: 'Potrero no encontrado' });
  }
}
