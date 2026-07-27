import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from './db.service';

/**
 * El día de la finca, de punta a punta.
 *
 * Antes, toda fecha del sistema salía de UTC: en Venezuela (UTC−4) lo cargado después de las 20:00
 * quedaba fechado al día siguiente. Ahora manda la zona de la organización, y esto lo verifica en
 * los dos lugares donde se decide un día:
 *
 *  - `db.today()`, que reemplaza a los ~50 `new Date().toISOString().slice(0, 10)` del servidor.
 *  - el `TimeZone` de la sesión, del que dependen los ~95 `CURRENT_DATE` y los casts a fecha.
 *
 * Las zonas de prueba son EXTREMAS a propósito (UTC+14 y UTC−11). Con Caracas el test solo
 * demostraría algo entre las 00 y las 04 UTC —y pasaría vacío el resto del día, que es la peor
 * clase de test—. Con estas dos, en cualquier momento al menos una difiere de UTC.
 */
describe('el día de la finca (zona de la organización)', () => {
  let db: DbService;
  let originalCwd: string;
  let tmp: string;

  /** `YYYY-MM-DD` de ahora en una zona, calculado aparte del código bajo prueba. */
  const hoyEn = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const conZona = async (tz: string) => {
    await db.query(`UPDATE organizations SET timezone = $1 WHERE id = $2`, [tz, db.tenant]);
    // El caché es por tenant y vive en memoria: hay que vaciarlo para leer la zona nueva.
    (db as unknown as { tzCache: Map<string, string> }).tzCache.clear();
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'farm-tz-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('AL MENOS UNA ZONA EXTREMA DIFIERE DE UTC AHORA MISMO', () => {
    // Es lo que hace que este test signifique algo a cualquier hora del día.
    const utc = hoyEn('UTC');
    expect([hoyEn('Pacific/Kiritimati'), hoyEn('Pacific/Midway')].some((d) => d !== utc)).toBe(true);
  });

  for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway', 'America/Caracas']) {
    it(`db.today() devuelve el día de ${tz}, no el de UTC`, async () => {
      await conZona(tz);
      expect(await db.timeZone()).toBe(tz);
      expect(await db.today()).toBe(hoyEn(tz));
    });

    it(`CURRENT_DATE en la sesión sigue a ${tz}`, async () => {
      await conZona(tz);
      // El interceptor hace esto en cada request; acá se reproduce dentro de una transacción.
      const dentro = await db.tx(async (q) => {
        await db.applyTenantContext(q, db.tenant);
        return (await q.one<{ d: string }>(`SELECT CURRENT_DATE::text AS d`))!.d;
      });
      expect(dentro).toBe(hoyEn(tz));
    });
  }

  it('el cast de un INSTANTE a fecha usa la zona de la finca', async () => {
    // El caso real: un tratamiento aplicado a las 20:30 en Venezuela es del 26, no del 27.
    await conZona('America/Caracas');
    const d = await db.tx(async (q) => {
      await db.applyTenantContext(q, db.tenant);
      return (await q.one<{ d: string }>(`SELECT '2026-07-26T20:30:00-04:00'::timestamptz::date::text AS d`))!.d;
    });
    expect(d).toBe('2026-07-26');
  });

  it('FUERA DE UNA REQUEST, `today()` y `CURRENT_DATE` hablan del MISMO día', async () => {
    // El seed, los jobs y los tests corren sin interceptor. Cuando ahí la sesión quedaba en UTC y
    // `db.today()` en hora de finca, entre las 00:00 y las 03:00 UTC eran días distintos: la suite
    // pasaba 21 horas por día y fallaba 3, sin que nadie hubiera tocado nada. Un test que depende
    // de la hora a la que se corre es peor que uno que falla siempre.
    //
    // Se comprueba con la zona del demo tal como arrancó, sin tocar nada: es la situación real.
    const hoy = await db.today();
    const [{ d }] = await db.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
    expect(d).toBe(hoy);
  });

  it('una zona inválida NO tumba la app: cae a UTC', async () => {
    // La zona sale de una columna editable. Si alguien guarda basura, la app tiene que seguir.
    await conZona('America/Nowhere');
    expect(await db.timeZone()).toBe('UTC');
    expect(await db.today()).toBe(hoyEn('UTC'));
  });

  it('la zona NO queda pegada a la conexión después de la transacción', async () => {
    // Con un pool, un TimeZone que sobrevive a la tx lo hereda la request siguiente: sería el mismo
    // tipo de estado residual que convierte un bug en una fuga entre fincas.
    await conZona('Pacific/Kiritimati');
    await db.tx(async (q) => {
      await db.applyTenantContext(q, db.tenant);
    });
    const fuera = (await db.one<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))!.tz;
    expect(fuera).not.toBe('Pacific/Kiritimati');
  });
});
