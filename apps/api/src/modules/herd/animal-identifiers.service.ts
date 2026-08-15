import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TagNumber } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { AnimalWriteService } from './animal-write.service';
import { HerdService } from './herd.service';
import { assertAnimal } from './assert-animal';

/**
 * Identificación avanzada del animal (A360 E4): visual, RFID, tatuaje, bolo, marca, biométrico
 * y oficial — alta, retiro con historial y marcado del oficial único.
 *
 * SEPARADO de `HerdService` siguiendo el precedente de `LotsService`: es un subdominio con sus
 * propias reglas (namespace de unicidad POR TIPO, un solo oficial por animal, el visual se
 * proyecta al canal de sync) que solo compartía el archivo con el resto del hato.
 *
 * DEPENDE de `HerdService` en una sola dirección y por una sola razón: las tres operaciones
 * devuelven la ficha completa del animal ya actualizada, y esa lectura vive en `getAnimal`.
 * `HerdService` NO conoce a este servicio —el controlador rutea a cada uno por su lado—, así
 * que no hay ciclo; `madge --circular` lo verifica en el gate.
 */
@Injectable()
export class AnimalIdentifiersService {
  private static readonly IDENTIFIER_TYPES = ['visual', 'rfid', 'tattoo', 'bolus', 'brand', 'biometric', 'official'];

  constructor(
    private readonly db: DbService,
    private readonly writer: AnimalWriteService,
    private readonly herd: HerdService,
  ) {}

  /** Proyecta al sync el visual ACTIVO vigente de un animal (o null si no queda ninguno). */
  private async syncVisualTag(q: Q, animalId: string) {
    const cur = await q.one<{ value: string }>(
      `SELECT value FROM animal_identifiers WHERE animal_id = $1 AND type = 'visual' AND deleted_at IS NULL AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [animalId],
    );
    const op = await this.writer.projectAnimalUpdate(q, animalId, { visual_tag: cur?.value ?? null });
    if (op) await this.writer.emitServerOrigin(q, [op], `rest:animal:identifier:${animalId}:${op.hlc}`);
  }

  /**
   * Agrega un identificador (A360 E4): visual/RFID/tatuaje/bolo/marca/biométrico/oficial.
   * Evita duplicados ACTIVOS del MISMO tipo (namespace por tipo). `is_official` es único por
   * animal (desmarca los demás). Un cambio de visual se propaga al canal de sync.
   */
  async addIdentifier(animalId: string, body: { type?: string; value?: string; is_official?: boolean }) {
    await assertAnimal(this.db, animalId);
    const t = this.db.tenant;
    const type = String(body?.type ?? '').trim();
    const rawValue = String(body?.value ?? '').trim();
    if (!AnimalIdentifiersService.IDENTIFIER_TYPES.includes(type))
      throw new BadRequestException({ code: 'identifier.invalid_type', title: 'Tipo de identificador inválido' });
    if (!rawValue) throw new BadRequestException({ code: 'identifier.missing_value', title: 'El valor del identificador es obligatorio' });
    const value = type === 'visual' && TagNumber.isValid(rawValue) ? TagNumber.of(rawValue) : rawValue;
    const isOfficial = !!body?.is_official || type === 'official';

    await this.db.tx(async (q) => {
      const dup = await q.one(
        `SELECT 1 FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
         WHERE ai.tenant_id = $1 AND ai.type = $2 AND ai.value = $3 AND ai.deleted_at IS NULL AND ai.retired_at IS NULL AND a.status = 'active'`,
        [t, type, value],
      );
      if (dup) throw new BadRequestException({ code: 'identifier.duplicate', title: `Ya hay un animal activo con ${type} ${value}` });
      if (isOfficial)
        await q.query(`UPDATE animal_identifiers SET is_official = false, updated_at = now() WHERE animal_id = $1 AND is_official = true AND deleted_at IS NULL`, [animalId]);
      await q.query(
        `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value, is_official, issued_at) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE)`,
        [t, animalId, type, value, isOfficial],
      );
      if (type === 'visual') await this.syncVisualTag(q, animalId);
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'identifier_added',$3,now(),now(),'manual')`,
        [t, animalId, JSON.stringify({ type, value, is_official: isOfficial })],
      );
    });
    return this.herd.getAnimal(animalId);
  }

  /** Retira un identificador (A360 E4): queda en el historial (retired_at) pero deja de ser activo. */
  async retireIdentifier(animalId: string, idfId: string) {
    await assertAnimal(this.db, animalId);
    const t = this.db.tenant;
    await this.db.tx(async (q) => {
      const idf = await q.one<{ type: string; value: string }>(
        `SELECT type, value FROM animal_identifiers WHERE id = $1 AND animal_id = $2 AND tenant_id = $3 AND deleted_at IS NULL AND retired_at IS NULL`,
        [idfId, animalId, t],
      );
      if (!idf) throw new NotFoundException({ code: 'identifier.not_found', title: 'Identificador no encontrado o ya retirado' });
      await q.query(`UPDATE animal_identifiers SET retired_at = CURRENT_DATE, is_official = false, updated_at = now() WHERE id = $1`, [idfId]);
      if (idf.type === 'visual') await this.syncVisualTag(q, animalId);
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'identifier_retired',$3,now(),now(),'manual')`,
        [t, animalId, JSON.stringify({ type: idf.type, value: idf.value })],
      );
    });
    return this.herd.getAnimal(animalId);
  }

  /** Marca un identificador como oficial (A360 E4): único por animal (desmarca los demás). */
  async makeOfficialIdentifier(animalId: string, idfId: string) {
    await assertAnimal(this.db, animalId);
    const t = this.db.tenant;
    await this.db.tx(async (q) => {
      const idf = await q.one<{ value: string }>(
        `SELECT value FROM animal_identifiers WHERE id = $1 AND animal_id = $2 AND tenant_id = $3 AND deleted_at IS NULL AND retired_at IS NULL`,
        [idfId, animalId, t],
      );
      if (!idf) throw new NotFoundException({ code: 'identifier.not_found', title: 'Identificador no encontrado' });
      await q.query(`UPDATE animal_identifiers SET is_official = false, updated_at = now() WHERE animal_id = $1 AND deleted_at IS NULL`, [animalId]);
      await q.query(`UPDATE animal_identifiers SET is_official = true, updated_at = now() WHERE id = $1`, [idfId]);
      await q.query(
        `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
         VALUES ($1,$2,'identifier_official',$3,now(),now(),'manual')`,
        [t, animalId, JSON.stringify({ value: idf.value })],
      );
    });
    return this.herd.getAnimal(animalId);
  }
}
