import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { AnimalWriteService } from './animal-write.service';
import { MovementService } from '../land/movement.service';

/**
 * Integración de las consultas batch de genealogía (P2 P-d.1) sobre PGlite en un
 * directorio temporal aislado (providers instanciados manualmente, ver el test del
 * procesador). Cubre loadGenealogyContext, detectCycles (ciclo profundo y límite) y
 * applyGenealogyLink (escritura + versiones merge + syncOp, y no-op sin cambios).
 */
describe('Genealogía · integración batch', () => {
  let db: DbService;
  let animalWrite: AnimalWriteService;
  let versions: SyncVersionStore;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'genealogy-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    versions = new SyncVersionStore(db);
    animalWrite = new AnimalWriteService(db, versions, new ServerOriginChangesetWriter(db), new MovementService(db, versions, new ServerOriginChangesetWriter(db)));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Inserta un animal activo (opcional dam/sire) + su caravana visual; devuelve id. */
  async function insertAnimal(tag: string, sex: 'F' | 'M', parents: { damId?: string; sireId?: string } = {}): Promise<string> {
    const a = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin, dam_id, sire_id)
         VALUES ($1,$2,$3,$4,'active','born',$5,$6) RETURNING id`,
        [tenantId, farmId, speciesId, sex, parents.damId ?? null, parents.sireId ?? null],
      )
    )[0];
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, a.id, tag]);
    return a.id;
  }
  const uniq = (p: string) => `GEN-${p}-${Date.now()}-${seq++}`;

  it('loadGenealogyContext resuelve caravana → {animalId, sexo} en una query', async () => {
    const dTag = uniq('DAM');
    const sTag = uniq('SIRE');
    const damId = await insertAnimal(dTag, 'F');
    const sireId = await insertAnimal(sTag, 'M');
    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [dTag, sTag, 'NO-EXISTE']));
    expect(ctx.get(dTag)).toEqual({ animalId: damId, sex: 'F' });
    expect(ctx.get(sTag)).toEqual({ animalId: sireId, sex: 'M' });
    expect(ctx.has('NO-EXISTE')).toBe(false);
  });

  it('detectCycles: ciclo profundo → cycle; sin ancestros → ok', async () => {
    const c = await insertAnimal(uniq('C'), 'F');
    const b = await insertAnimal(uniq('B'), 'F', { damId: c });
    const a = await insertAnimal(uniq('A'), 'F', { damId: b }); // A→B→C
    const res = await db.tx((q) =>
      animalWrite.detectCycles(q, [
        { childId: c, parentId: a }, // poner dam=A en C crearía C→A→B→C
        { childId: a, parentId: c }, // C no tiene ancestros
      ]),
    );
    expect(res.get(`${c}|${a}`)).toBe('cycle');
    expect(res.get(`${a}|${c}`)).toBe('ok');
  });

  it('detectCycles: cadena > 32 → cycle_check_limit (rechazo conservador)', async () => {
    // cadena X0→X1→…→X33 (34 animales); X33 es ancestro de X0 a profundidad 33 > 32
    let prev: string | undefined;
    const ids: string[] = [];
    for (let i = 33; i >= 0; i--) {
      const id = await insertAnimal(uniq(`X${i}`), 'F', { damId: prev });
      ids.unshift(id);
      prev = id;
    }
    const x0 = ids[0];
    const x33 = ids[33];
    const res = await db.tx((q) => animalWrite.detectCycles(q, [{ childId: x33, parentId: x0 }]));
    expect(res.get(`${x33}|${x0}`)).toBe('cycle_check_limit');
  });

  it('applyGenealogyLink escribe dam_id, MERGEA versiones y devuelve syncOp', async () => {
    const childId = await insertAnimal(uniq('CH'), 'F');
    const damId = await insertAnimal(uniq('DM'), 'F');
    const r = await db.tx(async (q) => {
      await versions.write(q, 'animals', childId, { status: '00000000000001:000000:server' }); // versión previa (create-pass)
      return animalWrite.applyGenealogyLink(q, childId, damId);
    });
    expect(r.syncOp?.fields).toEqual({ dam_id: damId });
    const dam = (await db.query<{ dam_id: string }>(`SELECT dam_id FROM animals WHERE id = $1`, [childId]))[0];
    expect(dam.dam_id).toBe(damId);
    const v = (await db.query<{ versions: Record<string, string> }>(`SELECT versions FROM sync_row_state WHERE table_name='animals' AND row_id=$1`, [childId]))[0];
    expect(v.versions.status).toBeTruthy(); // versión previa preservada (merge)
    expect(v.versions.dam_id).toBeTruthy(); // versión del vínculo agregada
  });

  it('applyGenealogyLink sin ids → no-op, sin syncOp', async () => {
    const childId = await insertAnimal(uniq('NOP'), 'F');
    const r = await db.tx((q) => animalWrite.applyGenealogyLink(q, childId));
    expect(r.syncOp).toBeUndefined();
    const dam = (await db.query<{ dam_id: string | null }>(`SELECT dam_id FROM animals WHERE id = $1`, [childId]))[0];
    expect(dam.dam_id).toBeNull();
  });
});
