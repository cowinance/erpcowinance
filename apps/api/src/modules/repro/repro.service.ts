import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Sex, addFarmDays, computeExpectedDueDateFromService, computeExpectedDueDateFromDiagnosis, newbornCategoryCode, validateProtocolSteps, InvalidProtocolStepsError, computeReproStatus, DEFAULT_REPRO_CONFIG } from '@cowinance/domain';
import type { ReproConfig, ReproFacts } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { insertAnimalEvent, requireAnimal } from '../../common/events';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { StrawsService } from '../genetics/straws.service';
import { calvingIntervalIssue } from '@cowinance/domain';
import { InbreedingService } from '../genetics/inbreeding.service';
import { ServicePlanService } from './service-plan.service';

@Injectable()
export class ReproService {
  constructor(
    private readonly db: DbService,
    private readonly weanings: WeaningService,
    private readonly tasks: TaskService,
    private readonly semen: SemenService,
    private readonly embryos: EmbryosService,
    private readonly straws: StrawsService,
    private readonly plans: ServicePlanService,
    private readonly inbreeding: InbreedingService,
  ) {}

  /**
   * Guardas de servicio (integración Sanidad + Genética, E6): antes de registrar un servicio se valida
   * que el animal no tenga un RETIRO sanitario activo ni un CASO clínico grave abierto, y que el toro no
   * sea un pariente cercano de la vaca (consanguinidad). Cualquiera de estas condiciones BLOQUEA (409)
   * salvo `force=true`, en cuyo caso devuelve las advertencias que se saltearon. No re-implementa
   * sanidad: consulta directamente las tablas (treatments/clinical_cases), sin acoplar módulos.
   */
  private async serviceGuards(
    animalId: string,
    sireId: string | null,
    force: boolean,
    /**
     * Guardas que el llamador ya evaluó (la calidad de la partida de semen, que solo él sabe cuál
     * es). Entran acá para que TODAS las razones se decidan y se informen en un solo lugar: dos
     * bloqueos distintos con dos formatos de respuesta obligarían a la pantalla a entender dos.
     */
    extras: { extraWarnings?: string[]; extraDetails?: Record<string, unknown> } = {},
  ): Promise<string[]> {
    const t = this.db.tenant;
    const warnings: string[] = [...(extras.extraWarnings ?? [])];
    /** El detalle de cada guarda, para que el bloqueo explique y no solo prohíba. */
    const detalles: Record<string, unknown> = { ...(extras.extraDetails ?? {}) };
    const wd = await this.db.one<{ id: string }>(
      `SELECT id FROM treatments WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL
         AND (meat_withdrawal_until >= CURRENT_DATE OR milk_withdrawal_until >= now()) LIMIT 1`,
      [t, animalId],
    );
    if (wd) warnings.push('withdrawal_active');
    const sc = await this.db.one<{ id: string }>(
      `SELECT id FROM clinical_cases WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL
         AND status IN ('open','in_treatment','observation') AND severity='severe' LIMIT 1`,
      [t, animalId],
    );
    if (sc) warnings.push('open_severe_case');
    if (sireId) {
      // El padre tiene que ser MACHO. No es una guarda de riesgo sino de referencia equivocada, así
      // que `force` no la saltea: forzar existe para asumir un riesgo, no para guardar un imposible.
      //
      // La genealogía ya lo validaba al importar (`sex_incompatible`) y esta puerta no: dos caminos
      // hacia el mismo dato con reglas distintas, y la que no valida es por donde entra la basura.
      // Con un `sire_id` femenino, el ternero hereda esa paternidad al parir y después la evaluación
      // de toros rankea a una vaca.
      const padre = await this.db.one<{ sex: string }>(
        `SELECT sex FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [sireId, t],
      );
      if (!padre)
        throw new BadRequestException({ code: 'service.sire_not_found', title: 'El padre indicado no existe' });
      if (padre.sex !== 'M')
        throw new BadRequestException({
          code: 'service.sire_not_male',
          title: 'El padre de un servicio tiene que ser un macho',
        });

      // Consanguinidad por COEFICIENTE de Wright sobre seis generaciones, no por las cinco
      // relaciones de una generación que se miraban antes.
      //
      // Aquel chequeo dejaba pasar **abuelo × nieta**, que es el caso que más aparece: un toro se
      // queda tres o cuatro años en el rodeo, sus hijas entran a servicio —eso sí se detectaba— y
      // después entran las hijas de sus hijas, y ahí no decía nada. Es cuando la consanguinidad
      // empieza a cobrarse, y el daño queda en el hato.
      //
      // El cambio NO es regresivo: las cinco relaciones que bloqueaban dan todas F ≥ 12,5%, así que
      // nada de lo que antes se frenaba pasa ahora. Solo se agrega lo que faltaba.
      const consang = await this.inbreeding.forMating(sireId, animalId);
      if (consang.blocks) warnings.push('consanguinity');
      // El detalle viaja aparte del código: quien bloquea necesita saber CUÁNTO y por qué, no solo
      // que hubo parentesco. `12,5% — medios hermanos o abuelo/nieta` es accionable; «consanguinity»
      // obliga a adivinar.
      detalles.consanguinity = consang;
    }
    if (warnings.length && !force)
      throw new ConflictException({ code: 'service.blocked', title: 'Servicio bloqueado', reasons: warnings, details: detalles });
    return warnings;
  }

  /**
   * Revisión de sincronización: ¿esta receptora formó cuerpo lúteo?
   *
   * Es la mitad que faltaba para poder medir el protocolo. Antes, la vaca que no respondía se
   * anotaba como una nota suelta: quedaba visible en su ficha y era invisible para cualquier cuenta,
   * así que al final de la jornada nadie sabía cuántas del lote habían servido.
   *
   * Se registran las DOS respuestas con el mismo tipo de evento. Guardar solo los fracasos obligaría
   * a deducir el total desde las transferencias, y ese cálculo se rompe el día que una vaca responde
   * pero no recibe embrión —porque se acabaron, o porque el veterinario decidió que no—.
   */
  async recordSyncCheck(body: { animal_id?: string; responded?: boolean; notes?: string; occurred_at?: string }) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'sync_check.missing_animal', title: 'animal_id es obligatorio' });
    if (typeof body.responded !== 'boolean')
      throw new BadRequestException({ code: 'sync_check.missing_result', title: 'responded es obligatorio (true/false)' });

    const animal = await this.requireFemale(body.animal_id);
    const occurredAt = body.occurred_at ?? (await this.db.today());
    await insertAnimalEvent(
      this.db,
      body.animal_id,
      'synchronization_check',
      { responded: body.responded, notes: body.notes ?? null },
      occurredAt,
    );
    return { tag: animal.tag, responded: body.responded };
  }

  /**
   * El padre efectivo de un servicio.
   *
   * Lo explícito manda —el técnico puede corregir—, y si no vino se deriva de lo que se usó: la
   * partida de semen en una IA, el embrión en una transferencia. Las dos tablas guardan su
   * `sire_id`, así que pedirle al cliente que lo repita es pedirle que lo repita BIEN: alcanza con
   * que una pantalla se olvide para que el ternero nazca sin padre.
   *
   * Si la partida no tiene toro cargado devuelve `null`, igual que antes. No se inventa un padre.
   */
  private async resolveSire(explicito: string | null, semenBatchId: string | null, embryoId: string | null): Promise<string | null> {
    if (explicito) return explicito;
    const t = this.db.tenant;
    if (semenBatchId) {
      const b = await this.db.one<{ sire_id: string | null }>(
        `SELECT sire_id FROM semen_batches WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [semenBatchId, t],
      );
      return b?.sire_id ?? null;
    }
    if (embryoId) {
      const e = await this.db.one<{ sire_id: string | null }>(
        `SELECT sire_id FROM embryos WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [embryoId, t],
      );
      return e?.sire_id ?? null;
    }
    return null;
  }

  /**
   * Estado reproductivo AGREGADO por lote (E6): reusa `herdStatus` (regla única) y agrupa por lote —
   * cabezas, preñez %, listas para servicio, diagnóstico pendiente y abiertas. Rankea por «listas».
   */
  async reproByLot() {
    const herd = await this.herdStatus();
    const byLot = new Map<string, any>();
    for (const r of herd.rows) {
      const key = r.lot_id ?? 'none';
      if (!byLot.has(key)) byLot.set(key, { lot_id: r.lot_id, lot: r.lot ?? 'Sin lote', total: 0, pregnant: 0, due_soon: 0, ready_for_service: 0, diagnosis_pending: 0, open: 0 });
      const g = byLot.get(key);
      g.total++;
      if (r.status === 'pregnant' || r.status === 'due_soon') g.pregnant++;
      if (r.status === 'due_soon') g.due_soon++;
      if (r.status === 'ready_for_service') g.ready_for_service++;
      if (r.status === 'diagnosis_pending') g.diagnosis_pending++;
      if (r.status === 'open') g.open++;
    }
    const rows = [...byLot.values()]
      .map((g) => ({ ...g, pregnancy_rate_pct: g.total ? +((g.pregnant / g.total) * 100).toFixed(1) : null }))
      .sort((a, b) => b.ready_for_service - a.ready_for_service || b.total - a.total);
    return { rows };
  }

  /** id determinista uuid-like a partir de una clave de idempotencia + discriminante. */
  private deriveId(baseKey: string, discriminator: string): string {
    const h = createHash('sha1').update(`${baseKey}:${discriminator}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** Detección de celo — idempotente por Idempotency-Key. Registra intensidad y comportamiento. */
  async heat(animalId: string, body: any, idempotencyKey?: string) {
    const animal = await this.requireFemale(animalId);
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const id = idempotencyKey ? this.deriveId(idempotencyKey, animalId) : randomUUID();
    const payload = { intensity: body?.intensity ?? null, behavior: body?.behavior ?? null, notes: body?.notes ?? null };
    const existing = await this.db.one<any>(`SELECT id, occurred_at FROM breeding_events WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant]);
    if (existing) return { ...existing, tag: animal.tag, already: true };
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, notes, created_by)
       VALUES ($1,$2,$3,'heat',$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id, occurred_at`,
      [id, this.db.tenant, animalId, occurredAt, JSON.stringify(payload), this.db.user],
    );
    await insertAnimalEvent(this.db, animalId, 'heat', payload, occurredAt);
    return { ...row, tag: animal.tag };
  }

  /** Servicio: monta natural, inseminación artificial o transferencia embrionaria. Idempotente. */
  async service(animalId: string, body: any, idempotencyKey?: string) {
    const animal = await this.requireFemale(animalId);
    const method =
      body?.method === 'natural' ? 'service_natural' : body?.method === 'ai' ? 'service_ai' : body?.method === 'embryo_transfer' ? 'embryo_transfer' : null;
    if (!method)
      throw new BadRequestException({ code: 'service.invalid_method', title: "method debe ser 'natural', 'ai' o 'embryo_transfer'" });
    const occurredAt = body?.occurred_at ?? new Date().toISOString();
    const id = idempotencyKey ? this.deriveId(idempotencyKey, animalId) : randomUUID();
    const existing = await this.db.one<any>(`SELECT id, type, occurred_at FROM breeding_events WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant]);
    if (existing) return { ...existing, tag: animal.tag, already: true };
    const semenBatchId = method === 'service_ai' && body?.semen_batch_id ? body.semen_batch_id : null;
    const embryoId = method === 'embryo_transfer' && body?.embryo_id ? body.embryo_id : null;

    // El PADRE de una inseminación sale de la partida de semen, no hay que repetirlo.
    //
    // Antes se guardaba únicamente lo que mandara el cliente, y en una IA nadie lo manda —el toro va
    // implícito en la pajuela—. Resultado: `breeding_events.sire_id` quedaba NULL justo en los
    // servicios donde la genética se compró y se pagó. Tres consecuencias, todas silenciosas:
    // el ternero nacía sin padre (el parto copia el sire del evento), la evaluación de toros no veía
    // esas crías, y la guarda de consanguinidad no corría porque recibía `null`. Se podía inseminar
    // una vaca con semen de su propio padre y el sistema no decía nada.
    const sireId = await this.resolveSire(body?.sire_id ?? null, semenBatchId, embryoId);

    // Calidad de la partida: si se probó y dio mal, no se insemina sin decirlo explícitamente.
    //
    // Es el momento donde el dato salva plata. Sin esta guarda, una partida que ya se sabe muerta
    // —porque el termo se quedó sin nitrógeno— se usa en cincuenta vacas y el problema aparece a los
    // sesenta días, con todos los diagnósticos vacíos y la temporada perdida.
    const warningsPartida: string[] = [];
    const detallesPartida: Record<string, unknown> = {};
    if (semenBatchId) {
      const partida: any = await this.semen.get(semenBatchId);
      if (partida?.usability?.blocks) warningsPartida.push('semen_quality');
      if (partida?.usability) detallesPartida.semen_quality = partida.usability;
    }

    // Guardas (E6): retiro sanitario activo / caso clínico grave / consanguinidad. Bloquea salvo force.
    //
    // En una TRANSFERENCIA de embrión no se evalúa consanguinidad contra la receptora: ella gesta,
    // no aporta genes. El apareamiento que importaba —donante × toro— ya ocurrió cuando se armó el
    // embrión. Chequearla acá bloquearía transferencias perfectamente sanas por un parentesco que no
    // se hereda.
    const warnings = await this.serviceGuards(
      animalId,
      method === 'embryo_transfer' ? null : sireId,
      body?.force === true,
      { extraWarnings: warningsPartida, extraDetails: detallesPartida },
    );

    // Consumo de pajuela/embrión (G-2): solo en AI con partida o en transferencia con embrión. Se
    // descuenta ANTES de registrar el servicio (regla única del saldo); si no alcanza (403), no queda
    // ni el servicio ni el consumo (en una request comparten la misma tx). Móvil/sync aún no lo envía.
    // `straw_id` (GT-2/GT-3): la pajuela CONCRETA. Si viene, se consume ésa —es el plan de servicio,
    // y también el desvío en el corral cuando el técnico usa otra distinta de la planificada—. Si no
    // viene, se toma la disponible más antigua y ubicada.
    const strawId = body?.straw_id ?? null;
    const consumidas: string[] = [];
    if (semenBatchId) consumidas.push(...(await this.semen.consumeStraw(semenBatchId, 'insemination', strawId)));
    if (embryoId) consumidas.push(...(await this.embryos.consumeStraw(embryoId, 'transfer', strawId)));
    const row = await this.db.one<any>(
      `INSERT INTO breeding_events (id, tenant_id, animal_id, type, occurred_at, sire_id, semen_batch_id, embryo_id, technician_id, protocol_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING RETURNING id, type, occurred_at`,
      [id, this.db.tenant, animalId, method, occurredAt, sireId, semenBatchId, embryoId, body?.technician_id ?? null, body?.protocol_id ?? null, body?.notes ?? null, this.db.user],
    );
    // Atar la pajuela al servicio: es lo que responde «¿QUÉ le pusimos a la 001?» con la unidad
    // concreta y no solo con la partida. Va después del INSERT porque necesita el id del evento, y
    // es atómico porque toda la request comparte una transacción.
    if (consumidas.length > 0 && row?.id) await this.straws.linkToEvent(this.db, consumidas, row.id);
    // Una transferencia ES la evidencia de que la receptora respondió: no se puede transferir sin
    // cuerpo lúteo. Se anota sola para que el denominador de la tasa de respuesta sea exacto sin
    // pedirle a la manga una segunda llamada con el animal encerrado.
    if (method === 'embryo_transfer')
      await this.recordSyncCheck({ animal_id: animalId, responded: true, occurred_at: occurredAt });

    await insertAnimalEvent(
      this.db,
      animalId,
      'service',
      { method: body.method, sire_id: sireId, expected_due: computeExpectedDueDateFromService(new Date(occurredAt)) },
      occurredAt,
    );
    return { ...row, tag: animal.tag, warnings, straw_ids: consumidas };
  }

  /**
   * Servicio GRUPAL (monta natural de toro sobre un lote, o selección): aplica la regla única `service`
   * por vientre activo, idempotente por (Idempotency-Key, animal). Salta machos/no-vientres.
   */
  async bulkService(body: any, idempotencyKey?: string) {
    if (!body?.method) throw new BadRequestException({ code: 'service.missing_method', title: 'method es obligatorio' });
    let animalIds: string[] = Array.isArray(body?.animal_ids) ? body.animal_ids : [];
    if (!animalIds.length && body?.lot_id) {
      const rows = await this.db.query<{ id: string }>(
        `SELECT a.id FROM animals a JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca','vaquillona')
         WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL AND a.current_lot_id = $2`,
        [this.db.tenant, body.lot_id],
      );
      animalIds = rows.map((r) => r.id);
    }
    if (!animalIds.length) throw new BadRequestException({ code: 'service.no_targets', title: 'Indicá animal_ids o un lot_id con vientres' });
    const baseKey = idempotencyKey ?? randomUUID();
    const applied: string[] = [];
    const skipped: { animal_id: string; reason: string }[] = [];
    for (const animalId of animalIds) {
      try {
        await this.service(animalId, body, this.deriveId(baseKey, animalId));
        applied.push(animalId);
      } catch (e: any) {
        skipped.push({ animal_id: animalId, reason: e?.response?.code ?? 'error' });
      }
    }
    return { applied: applied.length, skipped: skipped.length, skipped_detail: skipped };
  }

  /** Celos detectados sin servicio posterior (para decidir a quién servir). */
  async heatsNotServed(days = 30) {
    return this.db.query(
      `SELECT h.animal_id, ai.value AS tag, l.name AS lot, max(h.occurred_at)::text AS last_heat
       FROM breeding_events h
       JOIN animals a ON a.id = h.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE h.tenant_id = $1 AND h.type = 'heat' AND h.deleted_at IS NULL
         AND h.occurred_at >= CURRENT_DATE - ($2 || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM breeding_events s WHERE s.animal_id = h.animal_id AND s.deleted_at IS NULL
                          AND s.type IN ('service_natural','service_ai','embryo_transfer') AND s.occurred_at >= h.occurred_at)
         AND NOT EXISTS (SELECT 1 FROM pregnancies p WHERE p.animal_id = h.animal_id AND p.status = 'open' AND p.deleted_at IS NULL)
       GROUP BY h.animal_id, ai.value, l.name
       ORDER BY last_heat DESC LIMIT 100`,
      [this.db.tenant, days],
    );
  }

  /** Diagnóstico de gestación (ecografía/palpación). */
  async diagnose(body: any, idempotencyKey?: string) {
    if (!body?.animal_id || !body?.result)
      throw new BadRequestException({ code: 'diagnosis.missing_fields', title: 'animal_id y result (pregnant|empty|doubtful) son obligatorios' });
    if (!['pregnant', 'empty', 'doubtful'].includes(body.result))
      throw new BadRequestException({ code: 'diagnosis.invalid_result', title: "result debe ser 'pregnant', 'empty' o 'doubtful'" });
    const animal = await this.requireFemale(body.animal_id);
    const diagnosisDate = (body.diagnosis_date ? String(body.diagnosis_date).slice(0, 10) : await this.db.today());

    if (body.result === 'doubtful') {
      // Dudosa: no crea/cierra preñez; deja traza y agenda un RECONTROL (tarea) a los 14 días.
      return this.db.tx(async (q) => {
        await q.query(
          `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
           VALUES ($1,$2,'pregnancy_doubtful',$3,$4,now(),'manual')`,
          [this.db.tenant, body.animal_id, JSON.stringify({ method: body.method ?? 'ultrasound' }), diagnosisDate],
        );
        const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [this.db.tenant]))?.id ?? null;
        const due = new Date(new Date(diagnosisDate).getTime() + 14 * 86400000).toISOString();
        await this.tasks.createTask(q, { title: `Recontrol de diagnóstico — caravana ${animal.tag ?? '—'}`, type: 'breeding', dueDate: due, priority: 'normal', relatedType: 'animal', relatedId: body.animal_id, farmId: farm }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
        return { tag: animal.tag, result: 'doubtful', recheck_due: due.slice(0, 10) };
      });
    }

    if (body.result === 'pregnant') {
      const open = await this.db.one<any>(
        `SELECT id FROM pregnancies WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL`,
        [body.animal_id],
      );
      if (open)
        throw new BadRequestException({ code: 'diagnosis.already_pregnant', title: `${animal.tag} ya tiene una preñez abierta` });

      const pregnancyId = idempotencyKey ? this.deriveId(idempotencyKey, body.animal_id) : randomUUID();
      const dup = await this.db.one<any>(`SELECT id, diagnosis_date, expected_due_date FROM pregnancies WHERE id = $1 AND tenant_id = $2`, [pregnancyId, this.db.tenant]);
      if (dup) return { ...dup, tag: animal.tag, result: 'pregnant', already: true };

      const lastService = await this.db.one<any>(
        `SELECT id, occurred_at FROM breeding_events
         WHERE animal_id = $1 AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL
           AND occurred_at <= $2::date + 1
         ORDER BY occurred_at DESC LIMIT 1`,
        [body.animal_id, diagnosisDate],
      );
      const expectedDue = lastService
        ? computeExpectedDueDateFromService(new Date(lastService.occurred_at))
        : computeExpectedDueDateFromDiagnosis(new Date(diagnosisDate));

      const row = await this.db.one<any>(
        `INSERT INTO pregnancies (id, tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8) ON CONFLICT (id) DO NOTHING RETURNING id, diagnosis_date, expected_due_date`,
        [pregnancyId, this.db.tenant, body.animal_id, lastService?.id ?? null, diagnosisDate, body.method ?? 'ultrasound', expectedDue, this.db.user],
      );
      await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_diagnosed', { method: body.method ?? 'ultrasound', expected_due_date: expectedDue }, diagnosisDate);
      // E4 (Tareas): diagnóstico POSITIVO → tarea de seguimiento de preñez (dedup por preñez).
      await this.db.tx((q) =>
        this.tasks.createTask(
          q,
          { title: `Control de preñez — caravana ${animal.tag ?? '—'}`, type: 'breeding', dueDate: new Date(new Date(diagnosisDate).getTime() + 90 * 86400000).toISOString(), priority: 'normal', relatedType: 'animal', relatedId: body.animal_id, ruleKey: `preg_check:${pregnancyId}` },
          { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user },
        ),
      );
      return { ...row, tag: animal.tag, result: 'pregnant' };
    }

    // Vacía: si había preñez abierta, se marca perdida (reabsorción). Vuelve a estado abierta/elegible.
    const open = await this.db.one<any>(
      `UPDATE pregnancies SET status = 'lost', closed_at = $3, updated_at = now()
       WHERE animal_id = $1 AND status = 'open' AND deleted_at IS NULL AND tenant_id = $2 RETURNING id`,
      [body.animal_id, this.db.tenant, diagnosisDate],
    );
    await insertAnimalEvent(this.db, body.animal_id, 'pregnancy_negative', { method: body.method ?? 'ultrasound', previous_lost: !!open }, diagnosisDate);
    // E4 (Tareas): diagnóstico NEGATIVO → tarea para nuevo servicio (dedup por animal).
    await this.db.tx((q) =>
      this.tasks.createTask(
        q,
        { title: `Preparar nuevo servicio — caravana ${animal.tag ?? '—'}`, type: 'breeding', dueDate: new Date().toISOString(), priority: 'normal', relatedType: 'animal', relatedId: body.animal_id, ruleKey: `reservice:${body.animal_id}` },
        { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user },
      ),
    );
    return { tag: animal.tag, result: 'empty', previous_pregnancy_lost: !!open };
  }

  /**
   * Aborto / pérdida reproductiva: cierra la preñez abierta como 'aborted' con causa y edad
   * gestacional aproximada, deja traza en timeline y agenda una TAREA de revisión sanitaria. Idempotente.
   */
  async abortion(body: any, idempotencyKey?: string) {
    if (!body?.animal_id) throw new BadRequestException({ code: 'abortion.missing_fields', title: 'animal_id es obligatorio' });
    const animal = await this.requireFemale(body.animal_id);
    const occurredAt = (body.occurred_at ? String(body.occurred_at).slice(0, 10) : await this.db.today());
    return this.db.tx(async (q) => {
      const open = await q.one<any>(
        `UPDATE pregnancies SET status = 'aborted', closed_at = $3, loss_cause = $4, loss_gestational_days = $5, updated_at = now()
         WHERE animal_id = $1 AND tenant_id = $2 AND status = 'open' AND deleted_at IS NULL RETURNING id`,
        [body.animal_id, this.db.tenant, occurredAt, body.cause ?? null, body.gestational_age_days ?? null],
      );
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'abortion',$3,$4,now(),'manual')`,
        [this.db.tenant, body.animal_id, JSON.stringify({ cause: body.cause ?? null, gestational_age_days: body.gestational_age_days ?? null, had_open_pregnancy: !!open }), occurredAt],
      );
      const farm = (await q.one<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [this.db.tenant]))?.id ?? null;
      await this.tasks.createTask(q, { title: `Revisión por aborto — caravana ${animal.tag ?? '—'}`, type: 'health', dueDate: new Date().toISOString(), priority: 'high', relatedType: 'animal', relatedId: body.animal_id, farmId: farm }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
      return { tag: animal.tag, result: 'aborted', pregnancy_closed: !!open, occurred_at: occurredAt };
    });
  }

  /** Parto: cierra la preñez, registra el parto, da de alta las crías y agenda tareas postparto. Idempotente. */
  async calving(body: any, idempotencyKey?: string) {
    if (!body?.dam_id)
      throw new BadRequestException({ code: 'calving.missing_fields', title: 'dam_id es obligatorio' });
    const dam = await this.requireFemale(body.dam_id);
    const calvingDate = (body.calving_date ? String(body.calving_date).slice(0, 10) : await this.db.today());
    const crudas: any[] = Array.isArray(body.offspring) && body.offspring.length ? body.offspring : [{ sex: 'F', vitality: 'live' }];
    // El sexo de la cría se INTERPRETA igual que en el alta y en la planilla: quien anota un parto
    // en el corral escribe `H` de hembra, no `F` de female. Sin esto, ese `H` llegaba crudo al
    // INSERT y reventaba contra el CHECK de la base — un 500 en el registro de un parto, que es de
    // las cosas que más se cargan. Ahora, o se entiende, o es un 400 que dice qué se esperaba.
    const offspring = crudas.map((o, i) => {
      if (o?.sex === undefined || o?.sex === null || String(o.sex).trim() === '') return { ...o, sex: 'F' };
      const sexo = Sex.parse(o.sex);
      if (!sexo)
        throw new BadRequestException({
          code: 'calving.invalid_sex',
          title: `Sexo inválido en la cría ${i + 1}: se esperaba H o M (hembra/macho); también se aceptan F/M`,
        });
      return { ...o, sex: sexo as string };
    });

    // El id determinista se calcula ACÁ porque la guarda de intervalo lo necesita para excluirse a
    // sí misma. Ver el porqué en el comentario de la guarda.
    const calvingId = idempotencyKey ? this.deriveId(idempotencyKey, body.dam_id) : randomUUID();

    // La guarda de intervalo va DESPUÉS de validar las crías: un pedido malformado —un sexo que no
    // se entiende— es un 400 y no tiene por qué costar una consulta al historial del rodeo. Primero
    // se comprueba que lo que llegó tenga sentido; recién después, si es posible en esta vaca.
    //
    // Una vaca no puede parir dos veces separadas por menos de una gestación: habría tenido que
    // quedar preñada antes de parir. No es una heurística, es una imposibilidad física.
    //
    // Se frena ACÁ y no al leer, porque un dato imposible que entra ya no se corrige solo: infla los
    // kilos por año de esa vaca —seis partos en tres años daban «479 kg/año», casi el doble de lo
    // real— y encima de ese número se decide una reposición al revés.
    //
    // Bloquea salvo `force`, como el resto de las guardas: quien carga historia vieja con fechas
    // aproximadas tiene cómo seguir, pero tiene que decirlo.
    if (body?.force !== true) {
      // `id <> $3` — la guarda se EXCLUYE A SÍ MISMA. Sin esto, el reintento de un parto ya
      // registrado (que es lo que hace el móvil cuando se corta la señal) se encontraba con su
      // propio registro y lo rechazaba por «dos partos el mismo día». La idempotencia se rompía
      // justo en el escenario para el que existe.
      const previos = await this.db.query<{ d: string }>(
        `SELECT calving_date::text AS d FROM calvings
          WHERE dam_id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND id <> $3`,
        [body.dam_id, this.db.tenant, calvingId],
      );
      const choque = calvingIntervalIssue(calvingDate, previos.map((p) => p.d));
      if (choque)
        throw new ConflictException({
          code: 'calving.impossible_interval',
          title: choque.message,
          reasons: ['impossible_interval'],
          details: { conflicts_with: choque.conflictsWith, days: choque.days },
        });
    }
    const config = await this.reproConfig();

    return this.db.tx(async (q) => {
      const existing = await q.one<any>(`SELECT id, calving_date::text AS calving_date FROM calvings WHERE id = $1 AND tenant_id = $2`, [calvingId, this.db.tenant]);
      if (existing) return { ...existing, dam_tag: dam.tag, already: true };

      const pregnancy = await q.one<any>(
        `UPDATE pregnancies SET status = 'calved', closed_at = $3, updated_at = now()
         WHERE animal_id = $1 AND tenant_id = $2 AND status = 'open' AND deleted_at IS NULL RETURNING id, breeding_event_id`,
        [body.dam_id, this.db.tenant, calvingDate],
      );
      // De qué servicio viene esta preñez: define el padre, el método y —si fue transferencia— quién
      // es la madre GENÉTICA del ternero, que no es la que está pariendo.
      const evento = pregnancy?.breeding_event_id
        ? await q.one<any>(
            `SELECT be.sire_id, be.type, e.donor_dam_id
               FROM breeding_events be
               LEFT JOIN embryos e ON e.id = be.embryo_id AND e.deleted_at IS NULL
              WHERE be.id = $1`,
            [pregnancy.breeding_event_id],
          )
        : null;

      // TRANSFERENCIA: la que pare es la receptora. Gestó y va a amamantar, pero no aportó un solo
      // gen — el embrión ya estaba formado. Poner a la receptora como madre haría que la genealogía
      // mienta, y todo lo que se derive de ella hereda la mentira: el parentesco de esta cría, la
      // consanguinidad de SUS futuras crías, la evaluación genética.
      //
      // Si el embrión no tiene donante cargada se deja a la receptora como madre: reemplazar un dato
      // equivocado por ninguno es peor: al menos así queda de quién rastrear.
      const esTransferencia = evento?.type === 'embryo_transfer' && evento?.donor_dam_id;
      const madreGenetica = esTransferencia ? evento.donor_dam_id : body.dam_id;
      const receptora = esTransferencia ? body.dam_id : null;
      const metodo = evento?.type === 'embryo_transfer' ? 'et' : evento?.type === 'service_ai' ? 'ai' : 'natural';

      const calving = await q.one<any>(
        `INSERT INTO calvings (id, tenant_id, pregnancy_id, dam_id, calving_date, ease, offspring_count, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING id, calving_date`,
        [calvingId, this.db.tenant, pregnancy?.id ?? null, body.dam_id, calvingDate, body.ease ?? null, offspring.length, body.notes ?? null, this.db.user],
      );

      const species = await q.one<any>(`SELECT id FROM species WHERE code = 'bovine'`);
      const damRow = await q.one<any>(`SELECT farm_id, current_lot_id, current_paddock_id FROM animals WHERE id = $1`, [body.dam_id]);
      const calves: { animal_id: string | null; sex: string; vitality: string; tag: string | null }[] = [];
      for (const o of offspring) {
        let calfId: string | null = null;

        // La cría YA REGISTRADA se vincula, no se duplica.
        //
        // Pasa de verdad: el ternero se carga en la manga apenas nace —o entra por la planilla— y el
        // parto se anota después, en la oficina. Antes `animal_id` se ignoraba en silencio y la
        // segunda carga creaba un animal NUEVO: dos terneros donde había uno, los dos contando en el
        // hato, en los KPIs y en los kilos destetados de la madre. Se descubrió auditando, con 18
        // duplicados de golpe.
        if (o.animal_id) {
          const existente = await q.one<{ id: string; dam_id: string | null; sex: string }>(
            `SELECT id, dam_id, sex FROM animals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
            [o.animal_id, this.db.tenant],
          );
          if (!existente)
            throw new BadRequestException({ code: 'calving.offspring_not_found', title: 'La cría indicada no existe' });

          const yaVinculada = await q.one<{ calving_id: string }>(
            `SELECT calving_id FROM calving_offspring WHERE animal_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
            [o.animal_id, this.db.tenant],
          );
          if (yaVinculada)
            throw new ConflictException({
              code: 'calving.offspring_already_linked',
              title: 'Esa cría ya está registrada en otro parto',
            });

          // Si la cría ya tiene OTRA madre cargada, no se la pisa: o el parto es de otra vaca o la
          // genealogía estaba mal, y las dos cosas las tiene que resolver una persona.
          if (existente.dam_id && existente.dam_id !== madreGenetica)
            throw new ConflictException({
              code: 'calving.offspring_other_dam',
              title: 'Esa cría ya tiene otra madre registrada',
            });

          // Se completa lo que falte, sin tocar lo que ya estaba: el parto sabe de quién es hija y
          // cuándo nació, y esos datos suelen faltar cuando la cría se cargó a las apuradas.
          await q.query(
            `UPDATE animals
                SET dam_id = COALESCE(dam_id, $3),
                    recipient_dam_id = COALESCE(recipient_dam_id, $4),
                    sire_id = COALESCE(sire_id, $5),
                    birth_date = COALESCE(birth_date, $6::date),
                    breeding_method_origin = COALESCE(breeding_method_origin, $7),
                    updated_at = now()
              WHERE id=$1 AND tenant_id=$2`,
            [o.animal_id, this.db.tenant, madreGenetica, receptora, evento?.sire_id ?? null, calvingDate, metodo],
          );
          calfId = o.animal_id;
          // El sexo de la respuesta sale del ANIMAL, no del payload: para una cría que ya existe,
          // el dato bueno es el suyo. Reportar el que vino haría que la respuesta mienta cuando el
          // que anota el parto no manda el sexo (por defecto, hembra).
          o.sex = existente.sex;
        } else if (o.vitality !== 'stillborn') {
          const cat = await q.one<any>(`SELECT id FROM animal_categories WHERE code = $1`, [newbornCategoryCode(o.sex)]);
          const calf = await q.one<any>(
            `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, birth_date, origin, dam_id, recipient_dam_id, sire_id, breeding_method_origin, current_lot_id, current_paddock_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'born',$7,$8,$9,$10,$11,$12,'active',$13) RETURNING id`,
            [this.db.tenant, damRow.farm_id, species.id, cat?.id ?? null, o.sex ?? 'F', calvingDate, madreGenetica, receptora, evento?.sire_id ?? null, metodo, damRow.current_lot_id, damRow.current_paddock_id, this.db.user],
          );
          calfId = calf.id;
          if (o.tag) await q.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [this.db.tenant, calfId, String(o.tag)]);
          await q.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source) VALUES ($1,$2,'birth',$3,$4,now(),'manual')`, [this.db.tenant, calfId, JSON.stringify({ dam_tag: dam.tag, birth_weight_kg: o.birth_weight_kg ?? null, method: metodo, ...(receptora ? { recipient_dam_id: receptora, recipient_tag: dam.tag } : {}) }), calvingDate]);
        }
        await q.query(
          `INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [this.db.tenant, calving.id, calfId, o.birth_weight_kg ?? null, o.vitality ?? 'live', this.db.user],
        );
        calves.push({ animal_id: calfId, sex: o.sex, vitality: o.vitality ?? 'live', tag: o.tag ?? null });
      }

      await q.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source) VALUES ($1,$2,'calving',$3,$4,now(),'manual')`, [this.db.tenant, body.dam_id, JSON.stringify({ offspring: calves.length, ease: body.ease ?? null }), calvingDate]);

      // Tareas postparto (server-authored → sincronizan + agenda): revisión postparto (+30 d) y
      // preparación para nuevo servicio (al cumplir el VWP configurado).
      const reviewDue = new Date(new Date(calvingDate).getTime() + 30 * 86400000).toISOString();
      const prepDue = new Date(new Date(calvingDate).getTime() + config.vwpDays * 86400000).toISOString();
      await this.tasks.createTask(q, { title: `Revisión postparto — caravana ${dam.tag ?? '—'}`, type: 'breeding', dueDate: reviewDue, priority: 'normal', relatedType: 'animal', relatedId: body.dam_id, farmId: damRow.farm_id }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });
      await this.tasks.createTask(q, { title: `Preparar para servicio — caravana ${dam.tag ?? '—'}`, type: 'breeding', dueDate: prepDue, priority: 'normal', relatedType: 'animal', relatedId: body.dam_id, farmId: damRow.farm_id }, { origin: 'repro', emitServerOrigin: true, actorUserId: this.db.user });

      return { ...calving, dam_tag: dam.tag, offspring: calves };
    });
  }

  /**
   * Destete — adaptador REST delgado sobre la operación neutral `WeaningService`
   * (P5-1.c). Conserva el contrato observable (`{ id, weaning_date, weaning_weight_kg,
   * tag }`) más la mejora deliberada de atomicidad (hecho + pesaje + timeline en una
   * sola tx) e idempotencia. La regla vive UNA sola vez en `WeaningService`.
   */
  async weaning(body: any) {
    if (!body?.animal_id)
      throw new BadRequestException({ code: 'weaning.missing_fields', title: 'animal_id es obligatorio' });
    const res = await this.db.tx((q) =>
      this.weanings.recordWeaning(q, {
        animalId: body.animal_id,
        weaningDate: body.weaning_date,
        weightKg: body.weight_kg ?? null,
        weaningId: randomUUID(),
        actorUserId: this.db.user,
        origin: 'rest',
      }),
    );
    return { id: res.weaningId, weaning_date: res.weaningDate, weaning_weight_kg: res.weightKg, tag: res.tag };
  }

  /** Próximos partos (preñeces abiertas por fecha probable). */
  async upcomingCalvings(days = 60) {
    return this.db.query(
      `SELECT p.id, p.animal_id, ai.value AS tag, a.name, p.diagnosis_date, p.method, p.expected_due_date,
              (p.expected_due_date - CURRENT_DATE)::int AS days_until
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id AND a.status = 'active'
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.status = 'open' AND p.deleted_at IS NULL
         AND p.expected_due_date <= CURRENT_DATE + $2::int
       ORDER BY p.expected_due_date LIMIT 100`,
      [this.db.tenant, days],
    );
  }

  async pregnancies() {
    return this.db.query(
      `SELECT p.id, p.animal_id, ai.value AS tag, p.diagnosis_date, p.method, p.expected_due_date, p.status
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
       ORDER BY (p.status = 'open') DESC, p.expected_due_date LIMIT 200`,
      [this.db.tenant],
    );
  }

  async kpis() {
    const t = this.db.tenant;
    const [preg, services, calvings, weanings, dueSoon] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE p.status = 'open')::int AS open,
                (SELECT count(*)::int FROM animals a JOIN animal_categories c ON c.id = a.category_id
                 WHERE a.tenant_id = $1 AND a.status = 'active' AND c.code IN ('vaca','vaquillona') AND a.deleted_at IS NULL) AS females
         FROM pregnancies p WHERE p.tenant_id = $1 AND p.deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM breeding_events
         WHERE tenant_id = $1 AND type IN ('service_natural','service_ai') AND occurred_at >= now() - interval '90 days' AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM calvings WHERE tenant_id = $1 AND calving_date >= CURRENT_DATE - 365 AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n, avg(weaning_weight_kg)::float AS avg_kg FROM weanings
         WHERE tenant_id = $1 AND weaning_date >= CURRENT_DATE - 365 AND deleted_at IS NULL`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM pregnancies p JOIN animals a ON a.id = p.animal_id AND a.status = 'active'
         WHERE p.tenant_id = $1 AND p.status = 'open' AND p.expected_due_date <= CURRENT_DATE + 30 AND p.deleted_at IS NULL`,
        [t],
      ),
    ]);
    return {
      pregnancy_rate_pct: preg?.females ? +((preg.open / preg.females) * 100).toFixed(1) : null,
      open_pregnancies: preg?.open ?? 0,
      breeding_females: preg?.females ?? 0,
      services_90d: services?.n ?? 0,
      calvings_12m: calvings?.n ?? 0,
      weanings_12m: { n: weanings?.n ?? 0, avg_weight_kg: weanings?.avg_kg ? +weanings.avg_kg.toFixed(0) : null },
      calvings_due_30d: dueSoon?.n ?? 0,
    };
  }


  /**
   * Configuración reproductiva del rodeo: días voluntarios de espera y umbrales, leídos de las reglas
   * de alerta configurables (overrides por tenant) con fallback a `DEFAULT_REPRO_CONFIG` del dominio.
   */
  async reproConfig(): Promise<ReproConfig> {
    const rows = await this.db.query<{ code: string; days: number | null; is_active: boolean }>(
      `SELECT condition->>'code' AS code, (condition->>'days')::int AS days, is_active FROM alert_rules WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const by = new Map(rows.map((r) => [r.code, r]));
    const n = (code: string, fallback: number) => by.get(code)?.days ?? fallback;
    return {
      ...DEFAULT_REPRO_CONFIG,
      vwpDays: n('vwp_ready', DEFAULT_REPRO_CONFIG.vwpDays),
      diagnosisDueDays: n('diagnosis_due', DEFAULT_REPRO_CONFIG.diagnosisDueDays),
      openTooLongDays: n('open_too_long', DEFAULT_REPRO_CONFIG.openTooLongDays),
      repeatBreederServices: n('repeat_breeder', DEFAULT_REPRO_CONFIG.repeatBreederServices),
      calvingSoonDays: n('calving_soon', DEFAULT_REPRO_CONFIG.calvingSoonDays),
    };
  }

  /**
   * SQL de HECHOS reproductivos por vientre activo (vaca/vaquillona): preñez abierta, último parto,
   * último servicio, último diagnóstico negativo, último aborto, servicios desde el último parto y si
   * el lote está en un protocolo activo. Único lugar que arma los hechos que consume la regla pura
   * `computeReproStatus`. `extraFilter` acota (p. ej. por lote).
   */
  private reproFactsSql(extraFilter = ''): string {
    return `
      SELECT a.id AS animal_id, ai.value AS tag, a.name, a.current_lot_id AS lot_id, l.name AS lot,
             (c.code = 'vaquillona') AS is_heifer,
             p.expected_due_date::text AS expected_due_date,
             cal.last_calving::text AS last_calving, s.last_service::text AS last_service,
             neg.last_neg::text AS last_neg, ab.last_abortion::text AS last_abortion,
             COALESCE(scv.n, 0)::int AS services_since_calving,
             (prot.id IS NOT NULL) AS in_protocol
      FROM animals a
      JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca','vaquillona')
      LEFT JOIN lots l ON l.id = a.current_lot_id
      LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
      LEFT JOIN LATERAL (SELECT expected_due_date FROM pregnancies WHERE animal_id = a.id AND status='open' AND deleted_at IS NULL ORDER BY diagnosis_date DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT max(calving_date) AS last_calving FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL) cal ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_service FROM breeding_events WHERE animal_id = a.id AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL) s ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_neg FROM animal_events WHERE animal_id = a.id AND event_type = 'pregnancy_negative' AND deleted_at IS NULL) neg ON true
      LEFT JOIN LATERAL (SELECT max(closed_at) AS last_abortion FROM pregnancies WHERE animal_id = a.id AND status IN ('aborted','lost') AND deleted_at IS NULL) ab ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM breeding_events be WHERE be.animal_id = a.id AND be.type IN ('service_natural','service_ai','embryo_transfer') AND be.deleted_at IS NULL
                          AND be.occurred_at::date > COALESCE((SELECT max(calving_date) FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL), '1900-01-01'::date)) scv ON true
      LEFT JOIN LATERAL (SELECT pa.id FROM repro_protocol_assignments pa WHERE pa.lot_id = a.current_lot_id AND pa.tenant_id = a.tenant_id AND pa.status = 'active' AND pa.deleted_at IS NULL LIMIT 1) prot ON true
      WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL${extraFilter}`;
  }

  private factsOf(r: any): ReproFacts {
    return {
      isHeifer: !!r.is_heifer,
      culledReproductively: false,
      expectedDueDate: r.expected_due_date ? String(r.expected_due_date).slice(0, 10) : null,
      lastCalvingDate: r.last_calving ? String(r.last_calving).slice(0, 10) : null,
      lastServiceDate: r.last_service ? String(r.last_service).slice(0, 10) : null,
      lastPositiveDiagnosisDate: null,
      lastNegativeDiagnosisDate: r.last_neg ? String(r.last_neg).slice(0, 10) : null,
      lastAbortionDate: r.last_abortion ? String(r.last_abortion).slice(0, 10) : null,
      servicesSinceCalving: Number(r.services_since_calving ?? 0),
      inActiveProtocol: !!r.in_protocol,
    };
  }

  /**
   * Estado reproductivo del rodeo: cada vientre ACTIVO con su estado DERIVADO por la regla única
   * `computeReproStatus` desde eventos reales, más días postparto / abiertos / desde servicio. Snapshot.
   */
  async herdStatus(lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(`${this.reproFactsSql(lotFilter)} ORDER BY ai.value NULLS LAST`, params);
    const config = await this.reproConfig();
    const today = await this.db.today();

    const counts: Record<string, number> = { total: rows.length };
    const out = rows.map((r) => {
      const state = computeReproStatus(this.factsOf(r), config, today);
      counts[state.status] = (counts[state.status] ?? 0) + 1;
      return {
        animal_id: r.animal_id, tag: r.tag ?? null, name: r.name ?? null, lot: r.lot ?? null, lot_id: r.lot_id ?? null,
        status: state.status,
        days_postpartum: state.daysPostpartum, days_open: state.daysOpen, days_since_service: state.daysSinceService,
        expected_due_date: state.expectedDueDate, days_until: state.daysUntilDue,
        eligible_for_service: state.eligibleForService,
      };
    });
    return { lot_id: lotId ?? null, config, counts, rows: out };
  }

  /**
   * Estado reproductivo de UN vientre (para la ficha 360 del animal, A360 E3). Reusa la MISMA
   * regla única `computeReproStatus` y los mismos hechos (reproFactsSql) que herdStatus — sin
   * duplicar el estado. Devuelve null si el animal no es un vientre activo (macho / no vaca-vaquillona).
   */
  async animalStatus(animalId: string) {
    const rows = await this.db.query<any>(`${this.reproFactsSql(' AND a.id = $2')}`, [this.db.tenant, animalId]);
    if (!rows.length) return null;
    const config = await this.reproConfig();
    const today = await this.db.today();
    const r = rows[0];
    const state = computeReproStatus(this.factsOf(r), config, today);
    return {
      animal_id: r.animal_id,
      tag: r.tag ?? null,
      status: state.status,
      days_postpartum: state.daysPostpartum,
      days_open: state.daysOpen,
      days_since_service: state.daysSinceService,
      expected_due_date: state.expectedDueDate,
      days_until: state.daysUntilDue,
      eligible_for_service: state.eligibleForService,
      last_calving: r.last_calving ? String(r.last_calving).slice(0, 10) : null,
      last_service: r.last_service ? String(r.last_service).slice(0, 10) : null,
    };
  }

  /**
   * Próximas vacas a preparar para servicio: vientres en postparto cuyos días postparto alcanzarán el
   * VWP dentro de `withinDays` (aún no lo cumplen). Fuente única de hechos + regla pura.
   */
  async toPrepare(withinDays = 7) {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const today = await this.db.today();
    const out = rows
      .map((r) => ({ r, state: computeReproStatus(this.factsOf(r), config, today) }))
      .filter(({ state }) => state.daysPostpartum != null && state.expectedDueDate == null
        && state.daysPostpartum < config.vwpDays && config.vwpDays - state.daysPostpartum <= withinDays)
      .map(({ r, state }) => ({
        animal_id: r.animal_id, tag: r.tag ?? null, lot: r.lot ?? null,
        days_postpartum: state.daysPostpartum, days_to_vwp: config.vwpDays - (state.daysPostpartum ?? 0), status: state.status,
      }))
      .sort((a, b) => a.days_to_vwp - b.days_to_vwp);
    return { within_days: withinDays, vwp_days: config.vwpDays, count: out.length, rows: out };
  }

  private async ruleDays(code: string, fallback: number): Promise<number> {
    const r = await this.db.one<{ days: number | null }>(
      `SELECT (condition->>'days')::int AS days FROM alert_rules WHERE tenant_id=$1 AND condition->>'code'=$2 AND deleted_at IS NULL`,
      [this.db.tenant, code],
    );
    return r?.days ?? fallback;
  }

  /**
   * Alertas reproductivas DERIVADAS de la misma regla `computeReproStatus` (no re-implementa el estado
   * en SQL): diagnóstico pendiente / abierta demasiado tiempo / repetidora (por vientre) y agregadas de
   * «listas para servicio» (VWP cumplido) y «próximas a preparar». El motor de alertas filtra por regla
   * activa. Devuelve objetos con la forma `Desired` del módulo de alertas.
   */
  async statusAlerts(): Promise<any[]> {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const prepDays = await this.ruleDays('service_prep_due', 7);
    const today = await this.db.today();
    const out: any[] = [];
    let vwpReady = 0;
    let prepDue = 0;
    for (const r of rows) {
      const facts = this.factsOf(r);
      const st = computeReproStatus(facts, config, today);
      const tag = r.tag ?? '—';
      if (st.status === 'diagnosis_pending')
        out.push({ code: 'diagnosis_due', category: 'reproduction', severity: 'warning', title: `Diagnóstico pendiente — caravana ${tag}`, message: `Servicio sin diagnóstico hace ${st.daysSinceService} días`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'open')
        out.push({ code: 'open_too_long', category: 'reproduction', severity: 'warning', title: `Vaca abierta — caravana ${tag}`, message: `Abierta hace ${st.daysOpen} días (sin preñez)`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'repeat_breeder')
        out.push({ code: 'repeat_breeder', category: 'reproduction', severity: 'warning', title: `Repetidora — caravana ${tag}`, message: `${facts.servicesSinceCalving} servicios sin preñez`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      if (st.status === 'ready_for_service' && facts.lastCalvingDate) vwpReady++;
      if (st.daysPostpartum != null && st.expectedDueDate == null && st.daysPostpartum < config.vwpDays && config.vwpDays - st.daysPostpartum <= prepDays) prepDue++;
    }
    if (vwpReady > 0)
      out.push({ code: 'vwp_ready', category: 'reproduction', severity: 'info', title: `${vwpReady} vaca${vwpReady === 1 ? '' : 's'} lista${vwpReady === 1 ? '' : 's'} para servicio`, message: `Cumplieron el descanso postparto (${config.vwpDays} días)`, related_type: null, related_id: null, due_at: null, tag: null });
    if (prepDue > 0)
      out.push({ code: 'service_prep_due', category: 'reproduction', severity: 'info', title: `${prepDue} vaca${prepDue === 1 ? '' : 's'} estará${prepDue === 1 ? '' : 'n'} lista${prepDue === 1 ? '' : 's'} para servicio pronto`, message: `Se preparan para servicio en los próximos ${prepDays} días`, related_type: null, related_id: null, due_at: null, tag: null });
    return out;
  }

  // ── Protocolos reproductivos (IATF), plantillas (R-2.a) ──────────────────────
  private async requireFemale(animalId: string) {
    const animal = await requireAnimal(this.db, animalId);
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    if (animal.sex !== 'F')
      throw new BadRequestException({ code: 'repro.not_female', title: `${animal.tag} es macho: no admite eventos reproductivos de hembra` });
    return animal;
  }

}
