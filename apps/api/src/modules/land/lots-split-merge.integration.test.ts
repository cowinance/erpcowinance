import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { MovementService } from './movement.service';
import { LandService } from './land.service';
import { LotsService } from '../herd/lots.service';
import { HerdService } from '../herd/herd.service';
import type { AnimalWriteService } from '../herd/animal-write.service';

/**
 * Etapa 3 — dividir, fusionar y mover-todo el lote. Todas reusan la regla única `recordMovement`
 * (registran `animal_movements`, transaccional) y respetan las reglas de negocio.
 */
describe('Lotes — dividir / fusionar / mover todo', () => {
  let db: DbService;
  let land: LandService;
  let herd: HerdService;
  let lotsSvc: LotsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  const mkLot = async (name: string) => (await lotsSvc.createLot({ name }) as any).id;
  const mkPaddock = async (name: string) =>
    (await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [db.tenant, farmId, name]))[0].id;
  const addAnimals = async (lot: string, n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = (await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id) VALUES ($1,$2,$3,'F','active',$4) RETURNING id`,
        [db.tenant, farmId, speciesId, lot],
      ))[0].id;
      ids.push(id);
    }
    return ids;
  };
  const head = async (lot: string) => (await lotsSvc.getLot(lot) as any).head;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'split-merge-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    lotsSvc = new LotsService(db);
    land = new LandService(db, new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('mover todo: traslada todos los animales activos al destino y registra el movimiento', async () => {
    const a = await mkLot('MT A');
    const b = await mkLot('MT B');
    await addAnimals(a, 4);
    const res: any = await land.moveAllAnimals(a, { target_lot_id: b }, randomUUID());
    expect(res.moved).toBe(4);
    expect(await head(a)).toBe(0);
    expect(await head(b)).toBe(4);
    const mv = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animal_movements WHERE tenant_id=$1 AND to_lot_id=$2`, [db.tenant, b]);
    expect(mv[0].n).toBeGreaterThanOrEqual(4);
  });

  it('dividir: crea un lote nuevo y mueve el subconjunto elegido', async () => {
    const src = await mkLot('DIV src');
    const ids = await addAnimals(src, 6);
    const res: any = await land.splitLot(src, { name: 'DIV nuevo', purpose: 'weaning', animal_ids: ids.slice(0, 2) }, randomUUID());
    expect(res.moved).toBe(2);
    expect(res.new_lot_id).toBeTruthy();
    expect(await head(src)).toBe(4); // quedan 4
    expect(await head(res.new_lot_id)).toBe(2); // 2 en el nuevo
    const nl = await lotsSvc.getLot(res.new_lot_id) as any;
    expect(nl.purpose).toBe('weaning');
  });

  it('DIVIDIR NO PUEDE SACAR ANIMALES DE OTRO LOTE', async () => {
    // El bug: `splitLot` recibía una lista de ids y se la pasaba a `recordMovement` sin mirar de
    // dónde salían. Comprobado contra la app: dividir «Rodeo Cría 1» se llevó un animal de «Recría
    // 2026», el lote dividido quedó intacto, y el historial lo registró como una división normal.
    // El comentario de la función ya decía «(subconjunto del origen)»: describía la regla que nadie
    // aplicaba.
    const src = await mkLot('AJ origen');
    const otro = await mkLot('AJ otro');
    await addAnimals(src, 3);
    const ajenos = await addAnimals(otro, 2);

    await expect(land.splitLot(src, { name: 'AJ nuevo', animal_ids: ajenos }, randomUUID())).rejects.toMatchObject({
      status: 409,
      response: { code: 'lot.animals_not_in_lot' },
    });

    // Y no queda rastro: ni el lote nuevo ni un animal movido. La operación se rechaza ENTERA.
    expect(await head(otro), 'el otro lote no se tocó').toBe(2);
    expect(await head(src), 'el lote dividido tampoco').toBe(3);
    expect((await lotsSvc.lots() as any[]).some((l) => l.name === 'AJ nuevo'), 'no se creó el lote').toBe(false);
  });

  it('una lista MEZCLADA se rechaza entera, no se mueve «los que sí»', async () => {
    // Filtrar y mover el resto dejaría una división a medias que nadie pidió: la lista sale de una
    // pantalla que mostraba este lote, así que un id ajeno significa que lo que el productor está
    // mirando ya no es lo que hay.
    const src = await mkLot('MIX origen');
    const otro = await mkLot('MIX otro');
    const propios = await addAnimals(src, 3);
    const ajenos = await addAnimals(otro, 1);

    await expect(
      land.splitLot(src, { name: 'MIX nuevo', animal_ids: [...propios.slice(0, 2), ...ajenos] }, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    expect(await head(src), 'los propios tampoco se movieron').toBe(3);
  });

  it('REENVIAR LA MISMA DIVISIÓN devuelve el lote que ya se creó, no uno nuevo', async () => {
    // El `Idempotency-Key` protegía el movimiento pero no la creación del lote: `recordMovement`
    // deduplicaba por `movement_id` mientras el `INSERT INTO lots` corría igual. Un doble envío —un
    // toque repetido, una reconexión en el campo— dejaba DOS lotes, el segundo vacío y sin que nadie
    // se enterara. Comprobado contra la app antes del arreglo: `moved: 1` y después `moved: 0`, con
    // los dos lotes en la lista.
    const src = await mkLot('IDEM origen');
    const ids = await addAnimals(src, 4);
    const key = randomUUID();

    const a: any = await land.splitLot(src, { name: 'IDEM nuevo', animal_ids: ids.slice(0, 2) }, key);
    const b: any = await land.splitLot(src, { name: 'IDEM nuevo', animal_ids: ids.slice(0, 2) }, key);

    expect(b.new_lot_id, 'el reenvío tiene que devolver el MISMO lote').toBe(a.new_lot_id);
    expect(b.already).toBe(true);
    expect(b.moved, 'y decir cuántos movió de verdad, no cero').toBe(2);
    expect((await lotsSvc.lots() as any[]).filter((l) => l.name === 'IDEM nuevo'), 'un solo lote').toHaveLength(1);
    expect(await head(src)).toBe(2);
  });

  it('un animal repetido en la lista no cuenta dos veces', async () => {
    const src = await mkLot('DUP origen');
    const ids = await addAnimals(src, 3);
    const res: any = await land.splitLot(src, { name: 'DUP nuevo', animal_ids: [ids[0], ids[0], ids[1]] }, randomUUID());
    expect(res.moved).toBe(2);
    expect(await head(src)).toBe(1);
  });

  it('fusionar: mueve todo al destino y archiva el lote origen', async () => {
    const from = await mkLot('FUS from');
    const into = await mkLot('FUS into');
    await addAnimals(from, 3);
    await addAnimals(into, 2);
    const res: any = await land.mergeLots(from, { target_lot_id: into }, randomUUID());
    expect(res.merged).toBe(3);
    expect(await head(into)).toBe(5);
    // El lote origen quedó archivado (no aparece en la lista activa).
    const list: any[] = await lotsSvc.lots();
    expect(list.some((l) => l.id === from)).toBe(false);
  });

  it('reglas: no mover/fusionar a un lote archivado ni al mismo lote', async () => {
    const a = await mkLot('R A');
    const archived = await mkLot('R arch');
    await lotsSvc.deleteLot(archived); // vacío → archivado
    await addAnimals(a, 1);
    await expect(land.moveAllAnimals(a, { target_lot_id: archived }, randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(land.mergeLots(a, { target_lot_id: a }, randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(land.splitLot(a, { name: '', animal_ids: [] }, randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('ROTAR UN LOTE ABRE Y CIERRA SU PASTOREO: la ocupación no puede mentir', async () => {
    // El bug: eran dos registros que no se hablaban. Se rotaron dos lotes al «Potrero Norte» —31
    // cabezas— y la pantalla de Pastoreo seguía informando TODOS los potreros libres. Es la
    // pregunta con la que se decide a dónde mandar el rodeo mañana, contestada al revés.
    const lot = await mkLot('ROT pastoreo');
    await addAnimals(lot, 2);
    const p1 = await mkPaddock('ROT uno');
    const p2 = await mkPaddock('ROT dos');

    await land.moveLot(p1, { lot_id: lot });
    const abierto1 = await db.query<{ paddock_id: string; exit_date: string | null }>(
      `SELECT paddock_id, exit_date::text AS exit_date FROM grazing_records WHERE tenant_id=$1 AND lot_id=$2`, [db.tenant, lot]);
    expect(abierto1, 'entrar al primer potrero abre un pastoreo').toHaveLength(1);
    expect(abierto1[0].paddock_id).toBe(p1);
    expect(abierto1[0].exit_date).toBeNull();

    await land.moveLot(p2, { lot_id: lot });
    const todos = await db.query<{ paddock_id: string; exit_date: string | null }>(
      `SELECT paddock_id, exit_date::text AS exit_date FROM grazing_records WHERE tenant_id=$1 AND lot_id=$2 ORDER BY created_at`, [db.tenant, lot]);
    expect(todos, 'la rotación cierra el viejo y abre el nuevo').toHaveLength(2);
    expect(todos[0].exit_date, 'el del potrero que dejó queda cerrado').not.toBeNull();
    expect(todos[1].paddock_id).toBe(p2);
    expect(todos[1].exit_date, 'el del nuevo queda abierto').toBeNull();
  });

  it('la salida se fecha en el día de la FINCA, no en el de Greenwich', async () => {
    // Una rotación de las 21:00 no pertenece al día siguiente: con la fecha en UTC, los días de
    // pastoreo y de descanso —que se cuentan restando fechas— salían corridos.
    const lot = await mkLot('ROT fecha');
    await addAnimals(lot, 1);
    const p1 = await mkPaddock('ROT f1');
    const p2 = await mkPaddock('ROT f2');
    await land.moveLot(p1, { lot_id: lot });
    await land.moveLot(p2, { lot_id: lot });
    const [cerrado] = await db.query<{ exit_date: string }>(
      `SELECT exit_date::text AS exit_date FROM grazing_records WHERE tenant_id=$1 AND lot_id=$2 AND exit_date IS NOT NULL`, [db.tenant, lot]);
    expect(cerrado.exit_date).toBe(await db.today());
  });

  it('ARCHIVAR CON ANIMALES ADENTRO SE BLOQUEA POR LAS DOS PUERTAS', async () => {
    // Había dos caminos al mismo estado y solo uno tenía guarda: `DELETE` contestaba «el lote tiene
    // 21 animales; reasignalos antes de archivarlo», y `PUT {is_active:false}` lo archivaba con los
    // 21 puestos. El estado resultante era un callejón: a un lote archivado no se le pueden mover
    // animales, así que los de adentro quedaban en un lote que ya no podía recibir a nadie.
    const lot = await mkLot('ARCH con animales');
    await addAnimals(lot, 2);

    await expect(lotsSvc.deleteLot(lot)).rejects.toMatchObject({ status: 409, response: { code: 'lot.occupied' } });
    await expect(lotsSvc.updateLot(lot, { is_active: false })).rejects.toMatchObject({ status: 409, response: { code: 'lot.occupied' } });

    // Sigue activo: ninguna de las dos lo dejó a medias.
    expect(((await lotsSvc.getLot(lot)) as any).is_active).toBe(true);
  });

  it('vaciarlo lo desbloquea, y reactivar nunca necesita guarda', async () => {
    // La otra mitad: la guarda no puede haberse comido el caso legítimo. Un lote vacío se archiva, y
    // volver a activarlo no pide nada — un lote disponible otra vez no rompe nada.
    const lot = await mkLot('ARCH vaciable');
    const destino = await mkLot('ARCH destino');
    await addAnimals(lot, 2);
    await land.moveAllAnimals(lot, { target_lot_id: destino }, randomUUID());

    await lotsSvc.updateLot(lot, { is_active: false });
    expect(((await lotsSvc.getLot(lot)) as any).is_active).toBe(false);
    await lotsSvc.updateLot(lot, { is_active: true });
    expect(((await lotsSvc.getLot(lot)) as any).is_active).toBe(true);
  });
});
