import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from './db.service';
import { LotsService } from '../modules/herd/lots.service';

/**
 * Un identificador con forma inválida es un error DEL CLIENTE.
 *
 * Antes, cualquier `:id` que no fuera un uuid llegaba a PostgreSQL, fallaba con `22P02` y subía sin
 * traducir: **500 «Internal server error»** en las seis rutas que se probaron. Un 500 le dice al
 * cliente «fallé yo, reintentá» sobre algo que no va a funcionar nunca, y cada enlace viejo entra
 * al monitoreo como ERROR tapando los 500 de verdad.
 */
describe('identificador con forma inválida', () => {
  let db: DbService;
  let lots: LotsService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'invalid-id-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    lots = new LotsService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('UN ID QUE NO ES UUID DA 400, NO 500', async () => {
    await expect(lots.getLot('no-es-un-uuid')).rejects.toMatchObject({
      status: 400,
      response: { code: 'request.invalid_id' },
    });
  });

  it('un uuid VÁLIDO pero inexistente sigue dando 404', async () => {
    // La distinción importa: «mal escrito» y «no existe» son problemas distintos del usuario.
    await expect(lots.getLot('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  it('solo traduce 22P02: cualquier otro error de base sigue siendo del servidor', async () => {
    // Un error de sintaxis SQL es un bug nuestro y tiene que seguir doliendo como 500.
    await expect(db.query(`SELECT * FROM tabla_que_no_existe`)).rejects.not.toMatchObject({ status: 400 });
  });

  it('el mensaje NO filtra el error de PostgreSQL', async () => {
    // El detalle de `22P02` trae la clase del error; al usuario le llega una explicación en su idioma.
    const e: any = await lots.getLot('rules').catch((x) => x);
    expect(JSON.stringify(e.response)).not.toMatch(/22P02|uuid.*syntax|invalid input/i);
    expect(e.response.title).toMatch(/formato válido/i);
  });
});
