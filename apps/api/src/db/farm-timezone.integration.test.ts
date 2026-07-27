import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from './db.service';
import { safeTimeZone } from '@cowinance/domain';

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

  /**
   * La organización pasa a estar en esta zona, en los DOS lugares donde eso se nota.
   *
   * La zona vive por duplicado a propósito: `db.today()` la lee de `organizations` (con caché en
   * memoria) y los `CURRENT_DATE` la leen del `TimeZone` de la SESIÓN. El arranque las deja
   * alineadas; cambiar la columna con el proceso vivo alinea solo una. Si el helper moviera nada
   * más la columna, los tests que vienen después compararían la zona nueva contra la sesión vieja
   * y fallarían por el andamiaje, no por el sistema.
   */
  const conZona = async (tz: string) => {
    await db.query(`UPDATE organizations SET timezone = $1 WHERE id = $2`, [tz, db.tenant]);
    // El caché es por tenant y vive en memoria: hay que vaciarlo para leer la zona nueva.
    (db as unknown as { tzCache: Map<string, string> }).tzCache.clear();
    // `safeTimeZone` igual que el arranque: PostgreSQL RECHAZA una zona que no conoce, así que
    // pasarle la cruda haría explotar al helper justo en el test que comprueba que una zona
    // inválida no tumba la app.
    await db.query(`SELECT set_config('TimeZone', $1, false)`, [safeTimeZone(tz)]);
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
    // El test fija su propia zona en vez de heredar la que dejó el test anterior: si dependiera de
    // eso, volvería a ser un test que pasa o falla según la hora y el orden en que se lo corra.
    // Con una zona EXTREMA (UTC+14) además se distingue de UTC casi todo el día, así que compara
    // algo de verdad en vez de pasar vacío.
    await conZona('Pacific/Kiritimati');
    const hoy = await db.today();
    const [{ d }] = await db.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
    expect(d).toBe(hoy);
    expect(hoy).toBe(hoyEn('Pacific/Kiritimati'));
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
    // La sesión arranca en OTRA zona a propósito: así se ve si la de la transacción la pisa para
    // siempre. Comprobar solo `not.toBe(Kiritimati)` no distinguiría entre "no se pegó" y "nunca
    // se llegó a aplicar", que es justo lo que hay que separar acá.
    await db.query(`SELECT set_config('TimeZone', 'UTC', false)`);
    const dentro = await db.tx(async (q) => {
      await db.applyTenantContext(q, db.tenant);
      return (await q.one<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))!.tz;
    });
    const fuera = (await db.one<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))!.tz;
    expect(dentro).toBe('Pacific/Kiritimati'); // se aplicó
    expect(fuera).toBe('UTC'); // y se fue con la transacción
  });
});
