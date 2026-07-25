import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { NumberingService } from './numbering.service';

/**
 * La mitad de G4-2 que PGlite NO puede probar: que el `FOR UPDATE` realmente serialice.
 *
 * `numbering.integration.test.ts` cubre que el correlativo sea consecutivo y que un fallo devuelva
 * el número. Pero corre sobre PGlite, que es de UNA sola conexión: dos emisiones simultáneas no
 * existen ahí, el `FOR UPDATE` nunca llega a bloquear y **el test pasaría igual si lo borráramos**.
 * Ese es exactamente el bug que más caro sale acá — dos comprobantes con el mismo número, que se
 * descubre cuando el cliente presenta dos facturas iguales.
 *
 * Por eso esta suite necesita PostgreSQL de verdad, con conexiones de verdad. Se saltea si no hay
 * una, para no atar la suite a Docker. Para correrla:
 *
 *   docker compose up -d db
 *   PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5434/postgres \
 *     npx vitest run apps/api/src/modules/tax/numbering-concurrency
 */
const PG_URL = process.env.PG_TEST_URL;

describe.skipIf(!PG_URL)('numeración fiscal bajo concurrencia real', () => {
  // OJO: el cuerpo de un `describe.skipIf` SE EJECUTA aunque la suite esté salteada. Nada que lea
  // el entorno o construya servicios puede ir acá afuera — va en `beforeAll`.
  let db: DbService;
  let svc: NumberingService;
  let companyId: string;
  let originalCwd: string;
  let originalUrl: string | undefined;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalUrl = process.env.DATABASE_URL;
    tmp = mkdtempSync(join(tmpdir(), 'numconc-'));
    process.chdir(tmp);
    process.env.DATABASE_URL = PG_URL;
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new NumberingService(db);
    const c = await db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [db.tenant]);
    companyId = c!.id;
  }, 180_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('50 emisiones simultáneas dan 50 números distintos y consecutivos', async () => {
    await svc.create({ purpose: 'document', document_type: 'invoice' });

    const N = 50;
    const resultados = await Promise.all(
      Array.from({ length: N }, () => db.tx((q) => svc.allocateInTx(q, 'document', 'invoice', companyId))),
    );
    const numeros = resultados.map((r) => r.number).sort((a, b) => a - b);

    // Sin duplicados: es la propiedad que el `FOR UPDATE` protege.
    expect(new Set(numeros).size).toBe(N);
    // Y sin huecos: exactamente 1..N.
    expect(numeros).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  }, 120_000);

  it('con la mitad de las emisiones fallando, las que quedan siguen sin huecos', async () => {
    // El caso realista: algunas transacciones se caen. Las que sobreviven tienen que quedar
    // consecutivas, sin que las fallidas se hayan llevado un número puesto.
    await svc.create({ purpose: 'document', document_type: 'credit_note' });

    const N = 40;
    const intentos = Array.from({ length: N }, (_, i) =>
      db
        .tx(async (q) => {
          const r = await svc.allocateInTx(q, 'document', 'credit_note', companyId);
          if (i % 2 === 0) throw new Error('emisión fallida a propósito');
          return r;
        })
        .catch(() => null),
    );
    const oks = (await Promise.all(intentos)).filter(Boolean) as { number: number }[];
    const numeros = oks.map((r) => r.number).sort((a, b) => a - b);

    expect(numeros.length).toBe(N / 2);
    expect(new Set(numeros).size).toBe(N / 2);
    // Lo que importa: los 20 que se guardaron son 1..20 corridos. Si las fallidas hubieran quemado
    // su número (que es lo que haría una `sequence`), acá habría saltos.
    expect(numeros).toEqual(Array.from({ length: N / 2 }, (_, i) => i + 1));
  }, 120_000);

  it('el lote no se pasa de su tope aunque lo pidan todos a la vez', async () => {
    // Sin serialización, varias transacciones leerían el mismo `next` bajo el tope y emitirían todas
    // con formas que la imprenta nunca imprimió.
    await svc.create({ purpose: 'control', prefix: '00', range_from: 1, range_to: 10 });

    const intentos = Array.from({ length: 25 }, () =>
      db.tx((q) => svc.allocateInTx(q, 'control', 'invoice', companyId)).catch((e) => ({ error: e?.response?.code ?? 'otro' })),
    );
    const res = await Promise.all(intentos);
    const emitidos = res.filter((r: any) => !r.error) as { number: number }[];
    const agotados = res.filter((r: any) => r.error === 'tax.series_exhausted');

    expect(emitidos).toHaveLength(10); // exactamente el lote, ni uno más
    expect(agotados).toHaveLength(15);
    expect(emitidos.map((r) => r.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  }, 120_000);
});
