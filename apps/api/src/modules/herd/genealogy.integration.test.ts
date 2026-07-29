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

  it('loadGenealogyContext resuelve caravana → {animalId, sexo, nacimiento} en una query', async () => {
    // La FECHA entró después: sin ella la importación no podía verificar que un progenitor haya
    // existido cuando se concibió la cría, y por esa puerta entran miles de vínculos de una vez.
    const dTag = uniq('DAM');
    const sTag = uniq('SIRE');
    const damId = await insertAnimal(dTag, 'F');
    const sireId = await insertAnimal(sTag, 'M');
    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [dTag, sTag, 'NO-EXISTE']));
    expect(ctx.get(dTag)).toEqual({ animalId: damId, sex: 'F', birthDate: null });
    expect(ctx.get(sTag)).toEqual({ animalId: sireId, sex: 'M', birthDate: null });
    expect(ctx.has('NO-EXISTE')).toBe(false);
  });

  it('la fecha del progenitor llega COMO TEXTO, no como objeto Date', async () => {
    // PGlite devuelve las columnas `date` como objetos Date, y la regla de cronología compara
    // texto: sin el `::text` la comparación se haría contra «Sun Jun 01» y no contra «2020-06-01».
    // Es la trampa que ya mordió en destete y en el retiro.
    const tag = uniq('FECHA');
    const id = await insertAnimal(tag, 'F');
    await db.query(`UPDATE animals SET birth_date = '2020-06-01' WHERE id = $1`, [id]);
    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [tag]));
    expect(ctx.get(tag)!.birthDate).toBe('2020-06-01');
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

  it('LA IMPORTACIÓN TAMPOCO VINCULA UN PROGENITOR NACIDO DESPUÉS', async () => {
    // Es la puerta de más volumen: por acá entran miles de vínculos de una sola vez, y un pedigrí
    // imposible después lo recorren la consanguinidad, los kilos destetados por madre y el asesor de
    // apareamientos, que devuelven números perfectos sobre un árbol que no puede ser cierto.
    const madreTag = uniq('MJOVEN');
    const madreId = await insertAnimal(madreTag, 'F');
    await db.query(`UPDATE animals SET birth_date = '2025-01-01' WHERE id = $1`, [madreId]);
    const criaId = await insertAnimal(uniq('CRIA'), 'F');
    await db.query(`UPDATE animals SET birth_date = '2017-01-01' WHERE id = $1`, [criaId]);

    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [madreTag]));
    const { outcomes, damId } = animalWrite.evaluateLink(criaId, { damTag: madreTag, childBirthDate: '2017-01-01' }, ctx, new Map());

    expect(outcomes[0]).toEqual({ field: 'dam', outcome: 'born_after_child' });
    expect(damId, 'y no se escribe el vínculo').toBeUndefined();
  });

  it('una madre de verdad SÍ se vincula', async () => {
    // La otra mitad: la guarda no puede comerse el caso legítimo, que es el 99% de una importación.
    const madreTag = uniq('MOK');
    const madreId = await insertAnimal(madreTag, 'F');
    await db.query(`UPDATE animals SET birth_date = '2015-01-01' WHERE id = $1`, [madreId]);
    const criaId = await insertAnimal(uniq('CRIAOK'), 'F');

    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [madreTag]));
    const { outcomes, damId } = animalWrite.evaluateLink(criaId, { damTag: madreTag, childBirthDate: '2020-06-01' }, ctx, new Map());

    expect(outcomes[0]).toEqual({ field: 'dam', outcome: 'linked' });
    expect(damId).toBe(madreId);
  });

  it('sin fecha en la cría el vínculo pasa: no se bloquea por un dato que nadie tiene', async () => {
    const madreTag = uniq('MSF');
    const madreId = await insertAnimal(madreTag, 'F');
    await db.query(`UPDATE animals SET birth_date = '2025-01-01' WHERE id = $1`, [madreId]);
    const criaId = await insertAnimal(uniq('CRIASF'), 'F');

    const ctx = await db.tx((q) => animalWrite.loadGenealogyContext(q, [madreTag]));
    const { outcomes } = animalWrite.evaluateLink(criaId, { damTag: madreTag, childBirthDate: null }, ctx, new Map());
    expect(outcomes[0].outcome).toBe('linked');
  });
});
