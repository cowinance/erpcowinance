import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CryoStorageService } from './cryo-storage.service';
import { SemenService } from './semen.service';
import { EmbryosService } from './embryos.service';
import { StrawsService } from './straws.service';

/**
 * Pajuelas con identidad (GT-2).
 *
 * Lo que se comprueba: que el saldo sea DERIVADO de verdad (no quedó ningún contador escondido),
 * que la elección de cuál se consume no sea arbitraria, y que la máquina de estados impida deshacer
 * un consumo por la puerta de atrás.
 */
describe('pajuelas — identidad, ubicación y saldo derivado', () => {
  let db: DbService;
  let cryo: CryoStorageService;
  let semen: SemenService;
  let embryos: EmbryosService;
  let straws: StrawsService;
  let tmp: string;
  let originalCwd: string;
  let gobelete: string;
  let gobelete2: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'straws-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    cryo = new CryoStorageService(db);
    straws = new StrawsService(db);
    semen = new SemenService(db, straws);
    embryos = new EmbryosService(db, straws);

    const t: any = await cryo.createTank({ code: '207' });
    const c: any = await cryo.createCanister(t.id, { code: '2', color: 'azul' });
    gobelete = ((await cryo.createGoblet(c.id, { code: '5' })) as any).id;
    gobelete2 = ((await cryo.createGoblet(c.id, { code: '6' })) as any).id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('comprar una partida crea las unidades, sin ubicar', async () => {
    const lote: any = await semen.create({ batch_code: 'SANSAO', straws_available: 20 });
    expect(lote.straws_available).toBe(20);
    expect(lote.straws_unlocated).toBe(20);

    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    expect(unidades).toHaveLength(20);
    expect(unidades.every((u: any) => u.status === 'stored' && u.goblet_id === null)).toBe(true);
  });

  /**
   * La comprobación central de GT-2: si quedara un contador escondido en algún lado, este test
   * pasaría igual pero el saldo se desincronizaría en cuanto alguien tocara las unidades por otro
   * camino. Acá se cambian las unidades DIRECTAMENTE y el saldo de la partida tiene que seguirlas.
   */
  it('el saldo es derivado: cambiar las unidades cambia el saldo', async () => {
    const lote: any = await semen.create({ batch_code: 'DERIVADO', straws_available: 5 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });

    await straws.transition(unidades[0].id, 'lost', 'se descongeló');
    await straws.transition(unidades[1].id, 'discarded');

    const releido: any = await semen.get(lote.id);
    expect(releido.straws_available).toBe(3);
  });

  it('ubicar pajuelas separa lo disponible entre ubicado y sin ubicar', async () => {
    const lote: any = await semen.create({ batch_code: 'UBICAR', straws_available: 4 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    await straws.move([unidades[0].id, unidades[1].id], gobelete);

    const releido: any = await semen.get(lote.id);
    expect(releido).toMatchObject({ straws_available: 4, straws_located: 2, straws_unlocated: 2 });

    // Y el gobelete sabe qué tiene adentro: la otra mitad de la misma pregunta.
    const dentro = await straws.listByGoblet(gobelete);
    expect(dentro.filter((d: any) => d.batch_code === 'UBICAR')).toHaveLength(2);
  });

  it('la ubicación se resuelve hasta el termo', async () => {
    const lote: any = await semen.create({ batch_code: 'ETIQUETA', straws_available: 1 });
    const [u] = await straws.listFor({ semen_batch_id: lote.id });
    await straws.move([u.id], gobelete);
    const [releida]: any = await straws.listFor({ semen_batch_id: lote.id });
    expect(releida).toMatchObject({ tank_code: '207', canister_code: '2', canister_color: 'azul', goblet_code: '5' });
  });

  /**
   * Cuál se consume NO es arbitrario. Ubicada antes que sin ubicar, porque una pajuela sin ubicar no
   * se puede ir a buscar: descontarla dejaría el saldo bien y al operario sin nada que sacar.
   */
  it('consume primero lo ubicado, y dentro de eso lo más antiguo', async () => {
    const lote: any = await semen.create({ batch_code: 'FIFO', straws_available: 3 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    await straws.move([unidades[2].id], gobelete); // la última cargada es la única ubicada

    const r: any = await semen.adjustStraws(lote.id, -1, 'insemination');
    expect(r.consumed_straw_ids).toEqual([unidades[2].id]);
    expect(r.straws_available).toBe(2);
  });

  it('no deja consumir más de lo que hay', async () => {
    const lote: any = await semen.create({ batch_code: 'POCAS', straws_available: 1 });
    await expect(semen.adjustStraws(lote.id, -2, 'insemination')).rejects.toMatchObject({ status: 403 });
    // Y el intento fallido no dejó nada consumido a medias.
    expect(((await semen.get(lote.id)) as any).straws_available).toBe(1);
  });

  it('se puede consumir una pajuela CONCRETA (el plan de servicio y el desvío)', async () => {
    const lote: any = await semen.create({ batch_code: 'CONCRETA', straws_available: 3 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    const elegida = unidades[1].id;

    const ids = await semen.consumeStraw(lote.id, 'insemination', elegida);
    expect(ids).toEqual([elegida]);

    const releidas = await straws.listFor({ semen_batch_id: lote.id });
    expect(releidas.find((u: any) => u.id === elegida)?.status).toBe('used');
  });

  it('una pajuela ya usada no se puede volver a consumir', async () => {
    const lote: any = await semen.create({ batch_code: 'DOBLE', straws_available: 1 });
    const [u] = await straws.listFor({ semen_batch_id: lote.id });
    await semen.consumeStraw(lote.id, 'insemination', u.id);
    await expect(semen.consumeStraw(lote.id, 'insemination', u.id)).rejects.toMatchObject({ status: 409 });
  });

  /**
   * La regla que justifica la máquina de estados: devolver al stock una pajuela usada dejaría un
   * evento reproductivo apuntando a una unidad que el sistema cree entera.
   */
  it('una usada no vuelve al stock; una perdida sí', async () => {
    const lote: any = await semen.create({ batch_code: 'VUELTA', straws_available: 2 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });

    await semen.consumeStraw(lote.id, 'insemination', unidades[0].id);
    await expect(straws.transition(unidades[0].id, 'stored')).rejects.toMatchObject({ status: 409 });

    await straws.transition(unidades[1].id, 'lost', 'se cayó');
    expect(((await semen.get(lote.id)) as any).straws_available).toBe(0);
    await straws.transition(unidades[1].id, 'stored');
    expect(((await semen.get(lote.id)) as any).straws_available).toBe(1);
  });

  it('lo que ya salió del termo no se mueve', async () => {
    const lote: any = await semen.create({ batch_code: 'MOVER', straws_available: 2 });
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    await straws.transition(unidades[0].id, 'sold');
    await expect(straws.move([unidades[0].id, unidades[1].id], gobelete2)).rejects.toMatchObject({ status: 409 });
  });

  it('el código impreso se anota cuando se lee la pajuela', async () => {
    const lote: any = await semen.create({ batch_code: 'CODIGO', straws_available: 1 });
    const [u] = await straws.listFor({ semen_batch_id: lote.id });
    expect(u.code).toBeNull();
    const r: any = await straws.setCode(u.id, '  IMP-9987 ');
    expect(r.code).toBe('IMP-9987');
  });

  /**
   * Con embriones el contador PERDÍA información: una fila decía «4 embriones» y al transferir uno
   * desaparecía cuál. Ahora cada uno es una unidad rastreable hasta la receptora.
   */
  it('una colecta de embriones son unidades distinguibles', async () => {
    const colecta: any = await embryos.create({ stage: 'blastocisto', grade: '1', straws_available: 4 });
    expect(colecta.straws_available).toBe(4);
    const unidades = await straws.listFor({ embryo_id: colecta.id });
    expect(unidades).toHaveLength(4);
    expect(new Set(unidades.map((u: any) => u.id)).size).toBe(4);

    const elegido = unidades[2].id;
    await embryos.consumeStraw(colecta.id, 'transfer', elegido);
    const releidas = await straws.listFor({ embryo_id: colecta.id });
    expect(releidas.find((u: any) => u.id === elegido)?.status).toBe('used');
    expect(((await embryos.get(colecta.id)) as any).straws_available).toBe(3);
  });

  it('una pajuela es de un semen o de un embrión, nunca de los dos ni de ninguno', async () => {
    const lote: any = await semen.create({ batch_code: 'ORIGEN', straws_available: 1 });
    const colecta: any = await embryos.create({ straws_available: 1 });
    await expect(straws.createBatch({ semen_batch_id: lote.id, embryo_id: colecta.id }, { quantity: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(straws.createBatch({}, { quantity: 1 })).rejects.toMatchObject({ status: 400 });
  });
});
