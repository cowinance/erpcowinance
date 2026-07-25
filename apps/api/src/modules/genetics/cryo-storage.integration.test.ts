import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CryoStorageService } from './cryo-storage.service';
import { SemenService } from './semen.service';

/**
 * Ubicación criogénica (GT-1).
 *
 * Lo que se comprueba acá no es el CRUD —eso lo cubre el tipo— sino las tres reglas que evitan que
 * el termo del sistema y el termo real se separen: códigos únicos donde importa, capacidad que no
 * se pasa, y nada que se borre dejando contenido huérfano.
 */
describe('cryo storage — termo → canasta → gobelete', () => {
  let db: DbService;
  let cryo: CryoStorageService;
  let semen: SemenService;
  let tmp: string;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'cryo-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    cryo = new CryoStorageService(db);
    semen = new SemenService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un termo con su código hablado y sin nombre', async () => {
    const t: any = await cryo.createTank({ code: ' 207 ' });
    expect(t.code).toBe('207');
    expect(t.name).toBeNull();
    expect(t.canister_count).toBe(0);
  });

  // El código es para nombrar el termo hablando; dos iguales lo vuelven inútil.
  it('rechaza dos termos con el mismo código en la finca', async () => {
    await cryo.createTank({ code: '300' });
    await expect(cryo.createTank({ code: '300' })).rejects.toMatchObject({ status: 409 });
    // Y no distingue mayúsculas: «A1» y «a1» se dicen igual.
    await cryo.createTank({ code: 'A1' });
    await expect(cryo.createTank({ code: 'a1' })).rejects.toMatchObject({ status: 409 });
  });

  it('el código es obligatorio', async () => {
    await expect(cryo.createTank({ name: 'Termo de la sala' })).rejects.toMatchObject({ status: 400 });
  });

  it('arma el árbol completo: canastas con color y sus gobeletes', async () => {
    const t: any = await cryo.createTank({ code: '003', canister_capacity: 6 });
    // El caso que describe el productor: tres canastas azules, numeradas.
    for (const n of ['1', '2', '3']) await cryo.createCanister(t.id, { code: n, color: 'AZUL' });
    const canastas: any = await cryo.getTank(t.id);
    expect(canastas.canisters.map((c: any) => `${c.color} ${c.code}`)).toEqual(['azul 1', 'azul 2', 'azul 3']);

    const azul2 = canastas.canisters.find((c: any) => c.code === '2');
    await cryo.createGoblet(azul2.id, { code: '5', color: 'rojo' });
    const conGobelete: any = await cryo.getTank(t.id);
    const c2 = conGobelete.canisters.find((c: any) => c.code === '2');
    expect(c2.goblet_count).toBe(1);
    expect(c2.goblets[0]).toMatchObject({ code: '5', color: 'rojo' });
    // Los gobeletes cuelgan de SU canasta, no del termo.
    expect(conGobelete.canisters.find((c: any) => c.code === '1').goblets).toHaveLength(0);
  });

  // Mismo número de canasta en DOS termos distintos es lo normal: casi todos empiezan en 1.
  it('el número de canasta solo tiene que ser único dentro de su termo', async () => {
    const a: any = await cryo.createTank({ code: 'T-A' });
    const b: any = await cryo.createTank({ code: 'T-B' });
    await cryo.createCanister(a.id, { code: '1' });
    await expect(cryo.createCanister(b.id, { code: '1' })).resolves.toBeTruthy();
    await expect(cryo.createCanister(a.id, { code: '1' })).rejects.toMatchObject({ status: 409 });
  });

  // Descubrir que no entra la séptima canasta parado frente al termo abierto es caro: el nitrógeno
  // se evapora mientras se resuelve.
  it('no deja pasar la capacidad del termo', async () => {
    const t: any = await cryo.createTank({ code: 'CAP', canister_capacity: 2 });
    await cryo.createCanister(t.id, { code: '1' });
    await cryo.createCanister(t.id, { code: '2' });
    await expect(cryo.createCanister(t.id, { code: '3' })).rejects.toMatchObject({ status: 409 });
  });

  it('tampoco deja bajar la capacidad por debajo de lo ya cargado', async () => {
    const t: any = await cryo.createTank({ code: 'CAP2', canister_capacity: 4 });
    await cryo.createCanister(t.id, { code: '1' });
    await cryo.createCanister(t.id, { code: '2' });
    await expect(cryo.updateTank(t.id, { code: 'CAP2', canister_capacity: 1 })).rejects.toMatchObject({ status: 409 });
    // Igualar lo cargado sí se puede: describe el termo lleno.
    await expect(cryo.updateTank(t.id, { code: 'CAP2', canister_capacity: 2 })).resolves.toBeTruthy();
  });

  it('la capacidad de la canasta limita los gobeletes', async () => {
    const t: any = await cryo.createTank({ code: 'G1' });
    const c: any = await cryo.createCanister(t.id, { code: '1', goblet_capacity: 1 });
    await cryo.createGoblet(c.id, { code: '1' });
    await expect(cryo.createGoblet(c.id, { code: '2' })).rejects.toMatchObject({ status: 409 });
  });

  // Borrar de arriba hacia abajo dejaría contenido que el sistema cree que existe y nadie encuentra.
  it('no borra un termo con canastas, ni una canasta con gobeletes', async () => {
    const t: any = await cryo.createTank({ code: 'DEL' });
    const c: any = await cryo.createCanister(t.id, { code: '1' });
    const g: any = await cryo.createGoblet(c.id, { code: '1' });

    await expect(cryo.deleteTank(t.id)).rejects.toMatchObject({ status: 409 });
    await expect(cryo.deleteCanister(c.id)).rejects.toMatchObject({ status: 409 });

    // Vaciando de abajo hacia arriba, sí.
    await cryo.deleteGoblet(g.id);
    await cryo.deleteCanister(c.id);
    await expect(cryo.deleteTank(t.id)).resolves.toEqual({ ok: true });
  });

  it('el código de un termo dado de baja queda libre para el que lo reemplaza', async () => {
    const viejo: any = await cryo.createTank({ code: 'REEMPLAZO' });
    await cryo.deleteTank(viejo.id);
    await expect(cryo.createTank({ code: 'REEMPLAZO' })).resolves.toBeTruthy();
  });

  /**
   * Ésta es la que justifica la migración entera: `storage_tanks` existía, con RLS y con la clave
   * foránea desde semen_batches, y los servicios YA validaban tank_id — contra una tabla que ningún
   * endpoint podía llenar. El campo existía, se validaba, y nunca podía tener valor.
   */
  it('una partida de semen ya puede apuntar a un termo real', async () => {
    const t: any = await cryo.createTank({ code: 'USO' });
    const lote: any = await semen.create({ batch_code: 'SANSAO-1', straws_available: 20, tank_id: t.id });
    expect(lote.tank_id).toBe(t.id);
  });
});
