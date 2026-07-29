import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import { AnimalWriteService } from './animal-write.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from '../land/movement.service';

/**
 * Animales E2 — edición completa (updateAnimal): regla única, diff-aware, validaciones
 * (caravana duplicada, categoría/sexo compatibles, genealogía) y timeline de cambios.
 */
describe('HerdService.updateAnimal — edición completa (E2)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let catF: string; // categoría hembra (vaca)
  let catM: string; // categoría macho (toro)

  const mk = async (sex: string, tag: string, categoryId: string) => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, category_id) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [db.tenant, farmId, speciesId, sex, categoryId],
      )
    )[0].id;
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [db.tenant, id, tag]);
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'animupd-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    herd = new HerdService(db, writer, new BillingService(db));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    catF = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='vaca' LIMIT 1`))[0].id;
    catM = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code='toro' LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('edita nombre/color/notas y deja evento edit en el timeline', async () => {
    const id = await mk('F', 'E-1001', catF);
    const res: any = await herd.updateAnimal(id, { name: 'Estrella', coat_color: 'negra', notes: 'dócil' });
    expect(res.name).toBe('Estrella');
    expect(res.coat_color).toBe('negra');
    expect(res.notes).toBe('dócil');
    const tl: any[] = await herd.timeline(id);
    expect(tl.some((e) => e.event_type === 'edit' && e.payload?.changes?.includes('nombre'))).toBe(true);
  });

  it('renombra la caravana visual y rechaza duplicado activo', async () => {
    const a = await mk('F', 'E-2001', catF);
    const b = await mk('F', 'E-2002', catF);
    const res: any = await herd.updateAnimal(a, { visual_tag: 'E-2999' });
    expect(res.identifiers.find((i: any) => i.type === 'visual')?.value).toBe('E-2999');
    // b no puede tomar la caravana de a.
    await expect(herd.updateAnimal(b, { visual_tag: 'E-2999' })).rejects.toThrow();
  });

  it('valida sexo↔categoría', async () => {
    const id = await mk('F', 'E-3001', catF);
    // No puede pasar a categoría de macho manteniendo sexo F.
    await expect(herd.updateAnimal(id, { category_code: 'toro' })).rejects.toThrow();
  });

  it('bloquea cambio de sexo si es madre de otro animal', async () => {
    const dam = await mk('F', 'E-4001', catF);
    const calf = await mk('M', 'E-4002', catM);
    await herd.updateAnimal(calf, { dam_id: dam });
    await expect(herd.updateAnimal(dam, { sex: 'M', category_code: 'toro' })).rejects.toThrow();
  });

  it('setea madre válida y rechaza madre macho / autorreferencia / no existente', async () => {
    const calf = await mk('F', 'E-5001', catF);
    const dam = await mk('F', 'E-5002', catF);
    const bull = await mk('M', 'E-5003', catM);
    const ok: any = await herd.updateAnimal(calf, { dam_id: dam });
    expect(ok.dam_id).toBe(dam);
    await expect(herd.updateAnimal(calf, { dam_id: bull })).rejects.toThrow(); // macho como madre
    await expect(herd.updateAnimal(calf, { dam_id: calf })).rejects.toThrow(); // autorreferencia
    await expect(herd.updateAnimal(calf, { dam_id: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow();
  });

  it('rechaza ciclo genealógico', async () => {
    const parent = await mk('F', 'E-6001', catF);
    const child = await mk('F', 'E-6002', catF);
    await herd.updateAnimal(child, { dam_id: parent }); // child.dam = parent
    // parent.dam = child crearía un ciclo.
    await expect(herd.updateAnimal(parent, { dam_id: child })).rejects.toThrow();
  });

  it('rechaza fecha de nacimiento futura', async () => {
    const id = await mk('F', 'E-7001', catF);
    await expect(herd.updateAnimal(id, { birth_date: '2999-01-01' })).rejects.toThrow();
  });

  it('no crea evento si nada cambia (diff-aware)', async () => {
    const id = await mk('F', 'E-8001', catF);
    await herd.updateAnimal(id, { name: 'Luna' });
    const before = (await herd.timeline(id)).length;
    await herd.updateAnimal(id, { name: 'Luna' }); // mismo valor → sin cambios
    const after = (await herd.timeline(id)).length;
    expect(after).toBe(before);
  });

  it('UNA MADRE NO PUEDE HABER NACIDO DESPUÉS QUE SU HIJA', async () => {
    // Se verificaban existencia, sexo y ciclos, pero no las fechas. Comprobado contra la app: se
    // pudo poner como madre a una vaca nacida en 2025 de una hija nacida en 2017. Ese árbol lo
    // recorren la consanguinidad, los kilos destetados por madre y el asesor de apareamientos.
    const hija = await mk('F', 'CRONO-1', catF);
    const madre = await mk('F', 'CRONO-2', catF);
    await db.query(`UPDATE animals SET birth_date = '2017-08-08' WHERE id = $1`, [hija]);
    await db.query(`UPDATE animals SET birth_date = '2025-12-05' WHERE id = $1`, [madre]);

    await expect(herd.updateAnimal(hija, { dam_id: madre })).rejects.toMatchObject({
      response: { code: 'animal.parent_born_after_child' },
    });
  });

  it('el piso es UNA GESTACIÓN, no «nacer antes»', async () => {
    // Una madre nacida cien días antes que su cría tampoco pudo gestarla. El borde es la constante
    // que comparte con el intervalo entre partos, no un número aparte.
    const hija = await mk('F', 'CRONO-3', catF);
    await db.query(`UPDATE animals SET birth_date = '2020-06-01' WHERE id = $1`, [hija]);

    const casi = await mk('F', 'CRONO-4', catF);
    await db.query(`UPDATE animals SET birth_date = '2020-06-01'::date - 282 WHERE id = $1`, [casi]);
    await expect(herd.updateAnimal(hija, { dam_id: casi }), 'un día menos que la gestación').rejects.toThrow();

    const justa = await mk('F', 'CRONO-5', catF);
    await db.query(`UPDATE animals SET birth_date = '2020-06-01'::date - 283 WHERE id = $1`, [justa]);
    const r: any = await herd.updateAnimal(hija, { dam_id: justa });
    expect(r.dam_id, 'justo la gestación sí').toBe(justa);
  });

  it('cambiar la fecha de la CRÍA en la misma llamada no burla la guarda', async () => {
    // La cría puede estar corrigiendo su propia fecha junto con el vínculo. Si se comparara contra
    // la fecha vieja, editar las dos cosas de una vez dejaría pasar el vínculo imposible.
    const hija = await mk('F', 'CRONO-6', catF);
    const madre = await mk('F', 'CRONO-7', catF);
    await db.query(`UPDATE animals SET birth_date = '2015-01-01' WHERE id = $1`, [hija]);
    await db.query(`UPDATE animals SET birth_date = '2018-01-01' WHERE id = $1`, [madre]);

    // Con la fecha vieja de la hija (2015) la madre de 2018 es imposible; con la nueva (2022) sería
    // válida. Se pide el vínculo Y una fecha nueva ANTERIOR: tiene que rechazar.
    await expect(herd.updateAnimal(hija, { dam_id: madre, birth_date: '2016-01-01' })).rejects.toMatchObject({
      response: { code: 'animal.parent_born_after_child' },
    });
    // Y con una fecha nueva coherente, entra.
    const r: any = await herd.updateAnimal(hija, { dam_id: madre, birth_date: '2022-01-01' });
    expect(r.dam_id).toBe(madre);
  });

  it('EL BUSCADOR NO ENCUENTRA POR CARAVANAS RETIRADAS', async () => {
    // Recaravanear es normal: se saca la caravana de un animal y se le pone a otro. Sin filtrar los
    // retirados, buscar ese número devolvía DOS animales —el que la tiene y el que la tuvo— y el
    // segundo aparecía con su caravana actual, sin forma de saber por qué había salido.
    const viejo = await mk('F', 'RET-VIEJA', catF);
    const nuevo = await mk('F', 'RET-NUEVA', catF);
    await db.query(
      `UPDATE animal_identifiers SET retired_at = now() WHERE animal_id = $1 AND value = 'RET-VIEJA'`,
      [viejo],
    );
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','RET-VIEJA')`, [db.tenant, nuevo]);

    const res: any = await herd.listAnimals({ q: 'RET-VIEJA', limit: 10 } as any);
    expect(res.data, 'solo el que la tiene ahora').toHaveLength(1);
    expect(res.data[0].id).toBe(nuevo);
  });
});
