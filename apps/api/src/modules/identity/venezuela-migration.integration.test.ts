import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { checksumOf, loadMigrations, recordBaseline, resolveDbPath, runMigrations } from '../../db/migrations';
import { bootstrapCatalogs } from '../../db/seed';
import { countryDefaults, isSupportedCountry, supportedCountries } from './country-defaults';

/**
 * La migración 0016 (Venezuela) tiene una trampa de ORDEN que no se ve leyendo el archivo:
 * las migraciones corren ANTES de `bootstrapCatalogs`, y ese seed arranca con `if (n > 0) return`.
 *
 * O sea que una migración que inserte un país sin condición dejaría `countries` con una fila sobre
 * una base NUEVA, el centinela daría por sembrado el catálogo, y el seed se saltearía todo lo
 * demás: monedas, unidades, especies, razas y —lo peor— el rol `owner`, sin el cual no se puede
 * registrar nadie. La base quedaría rota de una forma que no falla al arrancar sino en el primer
 * registro.
 *
 * Estos dos tests fijan los DOS caminos, que es lo que la migración tiene que resolver a la vez:
 * base nueva (no toca nada, el seed pone todo) y base existente (rellena lo que el seed ya no va a
 * volver a mirar).
 */

/** Mismas adaptaciones que hace DbService al cargar el esquema en PGlite (sin extensiones, geography→jsonb). */
function schemaForPglite(): string {
  return readFileSync(resolve(resolveDbPath('cowinance_schema.sql')), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('CREATE EXTENSION'))
    .join('\n')
    .replace(/geography\([^)]*\)/g, 'jsonb');
}

async function bootBase(dir: string) {
  const db = new PGlite(join(dir, 'pg'));
  await db.waitReady;
  const driver = {
    query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    exec: (sql: string) => db.exec(sql).then(() => undefined),
  };
  const schemaSql = schemaForPglite();
  await db.exec(schemaSql);
  await recordBaseline(driver as any, checksumOf(schemaSql));
  return { db, driver };
}

describe('migración 0016 — Venezuela, sin romper el centinela del seed', () => {
  const tmps: string[] = [];
  const dbs: PGlite[] = [];

  const mk = () => {
    const t = mkdtempSync(join(tmpdir(), 'mig16-'));
    tmps.push(t);
    return t;
  };

  afterAll(async () => {
    for (const d of dbs) await d.close();
    for (const t of tmps) rmSync(t, { recursive: true, force: true });
  });

  describe('base NUEVA: migraciones primero, seed después', () => {
    let db: PGlite;
    const q = async <T = any>(sql: string, params?: unknown[]): Promise<T[]> => (await db.query<T>(sql, params)).rows;

    beforeAll(async () => {
      const b = await bootBase(mk());
      db = b.db;
      dbs.push(db);
      // El orden REAL de DbService.onModuleInit: esquema → migraciones → catálogos.
      await runMigrations(b.driver as any, loadMigrations(resolveDbPath('migrations')));
      await bootstrapCatalogs(b.driver as any);
    }, 180_000);

    it('la migración no siembra el país (lo hace el seed, que corre después)', async () => {
      // Si esto falla, la migración corrió sin condición y el centinela quedó envenenado.
      const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM countries`);
      expect(n).toBe(supportedCountries().length);
    });

    it('el seed cargó TODO el catálogo, no solo el país', async () => {
      const [{ n: monedas }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM currencies`);
      const [{ n: unidades }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM units`);
      const [{ n: owner }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM roles WHERE code='owner'`);
      expect(monedas).toBeGreaterThan(1);
      expect(unidades).toBeGreaterThan(1);
      expect(owner).toBe(1); // sin el rol owner no se puede registrar nadie
    });

    it('EL CATÁLOGO DE RAZAS ES EL DEL PAÍS DONDE SE USA LA APP', async () => {
      // Estaba armado con razas argentinas —Angus, Hereford, Brangus, Braford, Holando— y esto lo
      // recibía TODA finca, no solo el demo. Un productor venezolano importaba su planilla y el
      // sistema le rechazaba fila por fila las razas de su propio rodeo. Apareció auditando la
      // importación: Brahman, Nelore y Gyr, las tres más comunes del país, no existían.
      const razas = (await q<{ name: string }>(`SELECT name FROM breeds`)).map((r) => r.name);
      for (const r of ['Carora', 'Criollo Limonero', 'Brahman', 'Nelore', 'Gyr', 'Girolando', 'Mestizo', 'Pardo Suizo'])
        expect(razas, `falta ${r}`).toContain(r);
    });

    it('la CAROORA está, que es venezolana y de las principales', async () => {
      // Nació en Carora, estado Lara, cruzando Pardo Suizo con Criollo Limonero para tener una
      // lechera que aguante el trópico. Que faltara era la mejor prueba de que el catálogo miraba a
      // otro lado.
      const [carora] = await q(`SELECT name, purpose FROM breeds WHERE code = 'carora'`);
      expect(carora).toMatchObject({ name: 'Carora', purpose: 'dairy' });
    });

    it('no se sacó ninguna de las que ya estaban', async () => {
      // Hay fincas del Cono Sur: borrar una raza de un catálogo desplegado dejaría animales
      // apuntando a algo que ya no existe.
      const razas = (await q<{ name: string }>(`SELECT name FROM breeds`)).map((r) => r.name);
      for (const r of ['Angus', 'Hereford', 'Brangus', 'Braford', 'Holando Argentino']) expect(razas).toContain(r);
    });

    it('Venezuela quedó disponible con su moneda', async () => {
      const [ve] = await q(`SELECT code, name, traceability_authority FROM countries WHERE code='VE'`);
      expect(ve).toMatchObject({ name: 'Venezuela', traceability_authority: 'INSAI' });
      const [ves] = await q(`SELECT code, symbol FROM currencies WHERE code='VES'`);
      expect(ves).toMatchObject({ code: 'VES', symbol: 'Bs.' });
    });
  });

  describe('base EXISTENTE: el catálogo ya estaba, el seed no vuelve a mirar', () => {
    let db: PGlite;
    let dbDriver: unknown;
    const q = async <T = any>(sql: string, params?: unknown[]): Promise<T[]> => (await db.query<T>(sql, params)).rows;

    beforeAll(async () => {
      const b = await bootBase(mk());
      db = b.db;
      dbDriver = b.driver;
      dbs.push(db);
      // Estado de un servidor que ya venía corriendo: catálogo poblado SIN Venezuela.
      await runMigrations(b.driver as any, loadMigrations(resolveDbPath('migrations')).filter((m) => m.version < '0016'));
      await q(`INSERT INTO countries (code, name, name_en, traceability_authority) VALUES ('AR','Argentina','Argentina','SENASA')`);
      // USD va sí o sí: `bootstrapCatalogs` lo siembra en TODA instalación, así que un servidor real
      // siempre lo tiene. Sin él acá el fixture sería más pobre que la realidad y haría fallar por
      // una razón que en producción no existe.
      await q(`INSERT INTO currencies (code, name, symbol) VALUES ('ARS','Peso argentino','$'), ('USD','Dólar estadounidense','US$')`);
      // Y la ESPECIE con el catálogo de razas viejo, que es lo que de verdad tiene un servidor que
      // viene corriendo. Sin esto el fixture queda más pelado que la realidad y la migración de
      // razas no encontraría dónde insertar — fallaría por una razón que en producción no existe.
      const [{ id: bovino }] = await q<{ id: string }>(
        `INSERT INTO species (code, name, gestation_days) VALUES ('bovine','Bovino',283) RETURNING id`,
      );
      await q(
        `INSERT INTO breeds (species_id, code, name, purpose) VALUES
         ($1,'angus','Angus','beef'), ($1,'hereford','Hereford','beef'),
         ($1,'brangus','Brangus','beef'), ($1,'braford','Braford','beef'),
         ($1,'holando','Holando Argentino','dairy')`,
        [bovino],
      );
      // Y ahora sí, la migración bajo prueba.
      await runMigrations(b.driver as any, loadMigrations(resolveDbPath('migrations')));
    }, 180_000);

    it('rellena el país y la moneda que faltaban', async () => {
      const [ve] = await q(`SELECT code FROM countries WHERE code='VE'`);
      const [ves] = await q(`SELECT code FROM currencies WHERE code='VES'`);
      expect(ve).toBeTruthy();
      expect(ves).toBeTruthy();
    });

    it('no pisa lo que ya estaba', async () => {
      const [ar] = await q(`SELECT name FROM countries WHERE code='AR'`);
      expect(ar.name).toBe('Argentina');
    });

    it('no borra las razas que la finca ya tenía', async () => {
      // Sacar una raza de un catálogo desplegado dejaría animales apuntando a algo que ya no existe.
      const razas = (await q<{ name: string }>(`SELECT name FROM breeds`)).map((r) => r.name);
      for (const r of ['Angus', 'Hereford', 'Holando Argentino']) expect(razas).toContain(r);
    });

    it('LAS RAZAS LLEGAN TAMBIÉN A UNA BASE QUE YA ESTABA ANDANDO', async () => {
      // Arreglar `bootstrapCatalogs` alcanza para las fincas nuevas y para nadie más: esa función se
      // corta con un `if (n > 0) return` apenas encuentra catálogos cargados. La finca del productor
      // ya tiene datos, así que sin migración no vería la Carora nunca.
      const razas = (await q<{ name: string }>(`SELECT name FROM breeds`)).map((r) => r.name);
      for (const r of ['Carora', 'Criollo Limonero', 'Brahman', 'Nelore']) expect(razas, `falta ${r}`).toContain(r);
    });

    it('CORRERLA DOS VECES NO DUPLICA NINGUNA RAZA', async () => {
      // La restricción única de `breeds` es (tenant_id, species_id, code) y en las razas GLOBALES
      // `tenant_id` es NULL — que en PostgreSQL no choca contra sí mismo. O sea: la base no protege
      // acá, y un `ON CONFLICT` tampoco serviría. Lo hace el NOT EXISTS de la migración.
      //
      // Correrla de nuevo es alcanzable: una restauración de backup, un reintento manual, o una
      // segunda instancia arrancando. Sin el guard, cada raza quedaría dos veces y el productor
      // vería «Carora» repetida en cada selector.
      const mig = loadMigrations(resolveDbPath('migrations')).find((m) => m.version.startsWith('0034'));
      expect(mig, 'la migración de razas tiene que existir').toBeTruthy();
      await db.exec(mig!.sql);

      const dup = await q<{ name: string; n: number }>(
        `SELECT name, count(*)::int AS n FROM breeds GROUP BY name HAVING count(*) > 1`,
      );
      expect(dup, `duplicadas: ${dup.map((d) => d.name).join(', ')}`).toHaveLength(0);
    });

    it('registrar en Venezuela no rompe la FK a país', async () => {
      // Es EXACTAMENTE lo que fallaría sin la migración: el registro acepta el país (la validación
      // vive en TypeScript) y después revienta al insertar la organización.
      expect(isSupportedCountry('VE')).toBe(true);
      const d = countryDefaults('VE');
      const [org] = await q(
        `INSERT INTO organizations (name, country_code, default_currency, default_locale, timezone)
         VALUES ('Hato El Llano','VE',$1,$2,$3) RETURNING id, country_code, default_currency`,
        [d.currency, d.locale, d.timezone],
      );
      expect(org).toMatchObject({ country_code: 'VE', default_currency: 'USD' });
    });

    it('el bolívar queda disponible para el comprobante fiscal', async () => {
      // La moneda funcional es USD (ver country-defaults), pero VES tiene que EXISTIR igual: la
      // factura venezolana se expresa en bolívares. Sin esta fila, G4 no puede guardar el
      // equivalente en Bs y la FK de `invoices.currency` lo rechaza.
      const [ves] = await q(`SELECT code FROM currencies WHERE code='VES'`);
      expect(ves).toBeTruthy();
    });
  });
});
