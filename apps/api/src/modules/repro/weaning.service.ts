import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

/**
 * Núcleo NEUTRAL de destete (P5-1.c). Regla y escritura ÚNICAS del destete,
 * reutilizadas por REST/web y sync entrante. Cada canal aporta CONTEXTO explícito
 * (`origin`, `weaningId`, `hlc` cuando proceda); el cuerpo no ramifica por canal.
 *
 * El destete es un HECHO PRODUCTIVO: NO modifica ningún campo autoritativo del animal,
 * por lo que NO lleva `put` ni changeset server-origin (a diferencia de mortalidad). El
 * hecho y su pesaje viajan como intención event-only y se materializan en el servidor.
 *
 * En una sola transacción produce: (1) UNA fila `weanings`; (2) si hay peso, el PESAJE
 * asociado — dato propio del evento de destete, no una coincidencia temporal con un
 * pesaje genérico; (3) UN evento `weaning` de timeline. Si cualquier efecto falla, no
 * queda un destete parcial (la tx revierte).
 *
 * Idempotencia por `weaningId` (id de la fila `weanings`): un guard temprano evita
 * reprocesar. Además el pesaje asociado tiene IDENTIDAD DETERMINISTA derivada del
 * `weaningId` (mismo uuid en `weighings`, `ON CONFLICT (id) DO NOTHING`) → reprocesar el
 * mismo evento nunca crea otro destete, otro pesaje ni otro evento de timeline.
 */

export type WeaningOrigin = 'rest' | 'sync';

export interface RecordWeaningInput {
  animalId: string;
  weaningDate?: string;
  weightKg?: number | null;
  /** Clave de idempotencia = id de la fila `weanings` (uuid en REST, op id en sync). */
  weaningId: string;
  actorUserId: string;
  origin: WeaningOrigin;
  /** Permitido por simetría; hoy no se usa: el destete no escribe LWW (sin campo autoritativo). */
  hlc?: string;
}

export interface RecordWeaningResult {
  recorded: boolean;
  /** true si `weaningId` ya estaba registrado → no-op idempotente. */
  alreadyRecorded: boolean;
  weaningId: string;
  weaningDate: string;
  weightKg: number | null;
  tag: string | null;
}

@Injectable()
export class WeaningService {
  constructor(private readonly db: DbService) {}

  /**
   * Registra el destete de UN animal, atómico e idempotente por `weaningId`. Si hay peso,
   * la MISMA tx crea el pesaje asociado (identidad determinista). Rechaza (sin escritura)
   * si el animal no existe.
   */
  async recordWeaning(q: Q, input: RecordWeaningInput): Promise<RecordWeaningResult> {
    const t = this.db.tenant;

    // Idempotencia: la misma operación (mismo id) ya registrada → no-op total.
    const existing = await q.one<{ id: string; weaning_date: string; weaning_weight_kg: number | null }>(
      `SELECT id, weaning_date, weaning_weight_kg FROM weanings WHERE id = $1 AND tenant_id = $2`,
      [input.weaningId, t],
    );
    if (existing) {
      return {
        recorded: false,
        alreadyRecorded: true,
        weaningId: input.weaningId,
        weaningDate: existing.weaning_date,
        weightKg: existing.weaning_weight_kg,
        tag: null,
      };
    }

    // `dam_id` del destete es LA QUE CRIÓ, no la genética: el peso al destete es leche, y en una
    // transferencia la leche la puso la receptora. Acreditárselo a la donante le regalaría kilos que
    // no produjo y se los sacaría a la vaca que sí trabajó todo el ciclo.
    const animal = await q.one<{ id: string; dam_id: string | null; tag: string | null; birth_date: string | null }>(
      `SELECT a.id, COALESCE(a.recipient_dam_id, a.dam_id) AS dam_id, a.birth_date::text AS birth_date, ai.value AS tag
       FROM animals a
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x
         WHERE x.animal_id = a.id AND x.type = 'visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [input.animalId, t],
    );
    if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });

    const weaningDate = (input.weaningDate ? String(input.weaningDate).slice(0, 10) : await this.db.today(q));
    const weightKg = input.weightKg ?? null;

    // UN SOLO DESTETE POR ANIMAL. Se desteta una vez en la vida.
    //
    // La idempotencia de arriba cubre el reintento del MISMO registro; esto cubre lo otro: dos
    // cargas distintas del mismo destete, que es lo que pasa cuando lo anotan dos personas o cuando
    // se vuelve a cargar una planilla. El daño es directo sobre los números que se miran: en la
    // auditoría, tres destetes de un animal dieron una tasa de destete del 300% y le duplicaron los
    // kilos a la madre en la evaluación de vientres.
    const yaDestetado = await q.one<{ id: string; weaning_date: string }>(
      `SELECT id, weaning_date::text AS weaning_date FROM weanings
        WHERE animal_id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND id <> $3`,
      [input.animalId, t, input.weaningId],
    );
    if (yaDestetado)
      throw new ConflictException({
        code: 'weaning.already_weaned',
        title: `Este animal ya fue destetado el ${yaDestetado.weaning_date}. Un animal se desteta una sola vez.`,
      });

    // El peso tiene que ser un peso. Un negativo entraba y contaminaba el promedio del período y los
    // kilos destetados de la madre; un cero no distingue «pesó cero» de «no se pesó», que sí se
    // distinguen: para no pesarlo, se omite el campo.
    if (weightKg != null && !(Number(weightKg) > 0))
      throw new BadRequestException({
        code: 'weaning.invalid_weight',
        title: 'El peso al destete tiene que ser mayor que cero. Si no lo pesaste, dejá el campo vacío.',
      });

    // No se desteta antes de nacer. La evaluación de toros ya descartaba estos casos al leer
    // —los cuenta como «datos imposibles»—, pero descartar al leer no arregla el dato: queda ahí,
    // contando en el hato y en la tasa de destete.
    // `birth_date::text` en la consulta y no `String(...)` acá: PGlite devuelve las columnas `date`
    // como objetos Date, y `String(new Date(...)).slice(0,10)` da «Sun Jun 01» — comparado como
    // texto contra «2026-01-10» rechazaba destetes perfectamente válidos.
    if (animal.birth_date && weaningDate <= animal.birth_date.slice(0, 10))
      throw new BadRequestException({
        code: 'weaning.before_birth',
        title: 'La fecha de destete es anterior o igual a la de nacimiento.',
      });

    // Y no se desteta en el futuro: es un hecho, no un plan.
    const hoy = await this.db.today(q);
    if (weaningDate > hoy)
      throw new BadRequestException({
        code: 'weaning.future_date',
        title: `La fecha de destete (${weaningDate}) es futura. Un destete se registra cuando ocurrió.`,
      });

    // (1) hecho: fila weanings con id determinista = weaningId.
    await q.query(
      `INSERT INTO weanings (id, tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [input.weaningId, t, input.animalId, weaningDate, weightKg, animal.dam_id, input.actorUserId],
    );

    // (2) pesaje asociado (si hay peso), con identidad determinista derivada del weaningId.
    if (weightKg != null) {
      await q.query(
        `INSERT INTO weighings (id, tenant_id, animal_id, weighed_at, weight_kg, method, created_by)
         VALUES ($1,$2,$3,$4,$5,'scale',$6)
         ON CONFLICT (id) DO NOTHING`,
        [input.weaningId, t, input.animalId, weaningDate, weightKg, input.actorUserId],
      );
    }

    // (3) timeline: un evento weaning.
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,'weaning',$3,$4,now(),'manual')`,
      [t, input.animalId, JSON.stringify({ weight_kg: weightKg, origin: input.origin }), weaningDate],
    );

    return { recorded: true, alreadyRecorded: false, weaningId: input.weaningId, weaningDate, weightKg, tag: animal.tag };
  }
}
