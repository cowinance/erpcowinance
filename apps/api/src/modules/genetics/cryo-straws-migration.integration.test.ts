import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { checksumOf, loadMigrations, recordBaseline, resolveDbPath, runMigrations } from '../../db/migrations';

/**
 * La migración 0013 sobre datos REALES: contadores que se convierten en unidades.
 *
 * Es el único test que no puede escribirse contra la base ya migrada, porque para entonces la
 * columna `straws_available` ya no existe. Acá se reconstruye el estado ANTERIOR —esquema + las
 * migraciones hasta 0012—, se carga stock como lo tiene hoy un servidor en producción, y recién
 * después se aplica 0013.
 *
 * Sin esto, la primera vez que alguien la corriera contra su finca sería también la primera vez que
 * se ejecuta, y una migración que pierde stock no se nota hasta que falta una pajuela.
 */
describe('migración 0013 — el contador se convierte en unidades', () => {
  let db: PGlite;
  let tmp: string;
  let tenant: string;
  let lote: string;
  let colecta: string;

  const q = async <T = any>(sql: string, params?: unknown[]): Promise<T[]> => (await db.query<T>(sql, params)).rows;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mig13-'));
    db = new PGlite(join(tmp, 'pg'));
    await db.waitReady;

    const driver = {
      query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
      exec: (sql: string) => db.exec(sql).then(() => undefined),
    };

    // Mismas adaptaciones que hace DbService al cargar el esquema en PGlite: sin extensiones (no
    // están disponibles) y `geography` degradado a jsonb (en producción hay PostGIS de verdad).
    const schemaSql = readFileSync(resolve(resolveDbPath('cowinance_schema.sql')), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('CREATE EXTENSION'))
      .join('\n')
      .replace(/geography\([^)]*\)/g, 'jsonb');
    await db.exec(schemaSql);
    await recordBaseline(driver as any, checksumOf(schemaSql));

    // Estado previo: TODO menos la que se está probando.
    const todas = loadMigrations(resolveDbPath('migrations'));
    await runMigrations(driver as any, todas.filter((m) => m.version < '0013'));

    // Catálogos mínimos: la organización tiene FK a país y moneda. Se cargan a mano porque este
    // test arranca la base cruda, sin el `loadCatalogs` de DbService.
    await q(`INSERT INTO countries (code, name, name_en) VALUES ('AR','Argentina','Argentina')`);
    await q(`INSERT INTO currencies (code, name, symbol) VALUES ('ARS','Peso argentino','$')`);

    // Datos como los tiene hoy un servidor real: el stock es un número en la partida.
    const org: any = (await q(`INSERT INTO organizations (name, country_code, default_currency) VALUES ('Finca migración','AR','ARS') RETURNING id`))[0];
    tenant = org.id;
    const b: any = (
      await q(`INSERT INTO semen_batches (tenant_id, batch_code, straws_available) VALUES ($1,'SANSAO',20) RETURNING id`, [tenant])
    )[0];
    lote = b.id;
    const e: any = (await q(`INSERT INTO embryos (tenant_id, stage, straws_available) VALUES ($1,'blastocisto',4) RETURNING id`, [tenant]))[0];
    colecta = e.id;

    // Casos borde que no deben generar filas: saldo cero y partida dada de baja.
    await q(`INSERT INTO semen_batches (tenant_id, batch_code, straws_available) VALUES ($1,'VACIA',0)`, [tenant]);
    await q(`INSERT INTO semen_batches (tenant_id, batch_code, straws_available, deleted_at) VALUES ($1,'BAJA',7,now())`, [tenant]);

    // Y ahora sí, la migración bajo prueba.
    await runMigrations(driver as any, todas);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cada unidad del contador es ahora una pajuela', async () => {
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM cryo_straws WHERE semen_batch_id = $1`, [lote]);
    expect(n).toBe(20);
    const [{ m }] = await q<{ m: number }>(`SELECT count(*)::int AS m FROM cryo_straws WHERE embryo_id = $1`, [colecta]);
    expect(m).toBe(4);
  });

  /**
   * No se inventa una posición. Decir «están en el termo 1» sería peor que decir «no sé», porque
   * alguien lo creería y saldría a buscarlas ahí.
   */
  it('quedan SIN UBICAR y disponibles, con una nota que lo explica', async () => {
    const filas = await q(`SELECT status, goblet_id, notes FROM cryo_straws WHERE semen_batch_id = $1`, [lote]);
    expect(filas.every((f: any) => f.status === 'stored' && f.goblet_id === null)).toBe(true);
    expect(filas[0].notes).toMatch(/falta ubicarla/i);
  });

  it('no genera filas para saldo cero ni para partidas dadas de baja', async () => {
    const [{ n }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM cryo_straws s
       JOIN semen_batches b ON b.id = s.semen_batch_id
       WHERE b.batch_code IN ('VACIA','BAJA')`,
    );
    expect(n).toBe(0);
  });

  // Dos fuentes para el mismo número es el bug que la migración vino a eliminar. Si la columna
  // sobreviviera, alguien la leería.
  it('el contador ya no existe en ninguna de las dos tablas', async () => {
    const cols = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='straws_available'`,
    );
    expect(cols).toHaveLength(0);
  });

  it('la ubicación heredada en texto libre NO se destruye: es la pista del inventario físico', async () => {
    const cols = await q(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='semen_batches' AND column_name='canister'`,
    );
    expect(cols).toHaveLength(1);
  });

  it('la migración es idempotente: volver a correrla no duplica stock', async () => {
    const driver = {
      query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
      exec: (sql: string) => db.exec(sql).then(() => undefined),
    };
    await runMigrations(driver as any, loadMigrations(resolveDbPath('migrations')));
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM cryo_straws WHERE semen_batch_id = $1`, [lote]);
    expect(n).toBe(20);
  });
});
