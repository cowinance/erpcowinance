import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { SyncService } from './sync.service';
import { SyncHandlerRegistry } from './registry/sync-handler.registry';
import { BillingService } from '../billing/billing.service';
import { AnimalSyncHandler } from '../herd/sync/animal-sync.handler';
import { SyncVersionStore } from './registry/sync-version.store';
import { ServerOriginChangesetWriter } from './registry/server-origin-changeset.writer';
import { SyncConflictWriter } from './registry/sync-conflict.writer';
import { CAPACIDAD_DE_ESCRITURA, type SyncTable } from './contracts/sync-table';
import { ROLES, permite } from '../../common/permissions/matrix';

/**
 * El canal de sync respeta la matriz de permisos.
 *
 * REGRESIÓN de un agujero real: el interceptor autoriza RUTAS, y `/sync/push` es una sola ruta
 * bajo la capacidad `sincronizacion` —que todos los roles tienen, porque sin ella el móvil no
 * funciona—. Adentro viajan escrituras a trece tablas, y no se miraba el rol ni una vez. Verificado
 * contra la API antes de arreglarlo: un veterinario recibía 403 en `PUT /animals/:id` y el MISMO
 * cambio entraba por sync; el animal quedaba renombrado.
 */
describe('sync — el canal no esquiva los permisos', () => {
  let db: DbService;
  let sync: SyncService;
  let billing: BillingService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let animalId: string;
  let deviceId: string;
  let userId: string;

  const como = <T>(role: string, fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ userId, tenantId, role }, fn);

  /** Un push mínimo que renombra un animal — la operación exacta que se colaba. */
  const pushDeAnimal = (nombre: string, seq: number) => {
    const hlc = `${new Date().toISOString()}-0000-test`;
    return {
      device_id: deviceId,
      changesets: [
        {
          id: randomUUID(),
          deviceId,
          seq,
          hlc,
          schemaVersion: 1,
          ops: [{ kind: 'put' as const, table: 'animals', rowId: animalId, fields: { name: nombre }, hlc }],
        },
      ],
    };
  };

  /** Consumo de dispositivos según el plan — la misma cuenta que decide si entra uno más. */
  const consumoDeDispositivos = async (): Promise<number> =>
    ((await como('owner', () => billing.getSubscription())) as any).usage.devices;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'syncperm-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    tenantId = db.tenant;

    const versions = new SyncVersionStore(db);
    const writer = new ServerOriginChangesetWriter(db);
    const registry = new SyncHandlerRegistry();
    new AnimalSyncHandler(db, versions, new SyncConflictWriter(db), registry).onModuleInit();
    billing = new BillingService(db);
    sync = new SyncService(db, registry, billing);

    // Un usuario REAL: el contexto viaja a `created_by` de varias escrituras, y un id inventado
    // revienta con «invalid input syntax for type uuid» lejos de donde se declaró.
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    animalId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    const dev: any = await como('owner', () => sync.registerDevice({ platform: 'android', device_name: 'test' }));
    deviceId = dev.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('el capataz, que SÍ escribe el hato, sincroniza sin problema', async () => {
    const res: any = await como('foreman', () => sync.push(pushDeAnimal('Nombre del capataz', 1)));
    expect(res.accepted).toBe(1);
  }, 60_000);

  it('el veterinario NO puede escribir el hato por sync, igual que por REST', async () => {
    const antes = (await db.query<{ name: string }>(`SELECT name FROM animals WHERE id = $1`, [animalId]))[0].name;
    await expect(como('veterinarian', () => sync.push(pushDeAnimal('ESCRITO POR SYNC', 2)))).rejects.toMatchObject({
      response: { code: 'sync.sin_permiso' },
    });
    // Y lo que importa: no se aplicó NADA.
    const despues = (await db.query<{ name: string }>(`SELECT name FROM animals WHERE id = $1`, [animalId]))[0].name;
    expect(despues).toBe(antes);
  }, 60_000);

  it('el contador tampoco, que no toca un animal ni por REST ni por sync', async () => {
    await expect(como('accountant', () => sync.push(pushDeAnimal('del contador', 3)))).rejects.toMatchObject({
      response: { code: 'sync.sin_permiso' },
    });
  }, 60_000);

  it('una tabla que no participa del protocolo se rechaza', async () => {
    const hlc = `${new Date().toISOString()}-0000-test`;
    await expect(
      como('owner', () =>
        sync.push({
          device_id: deviceId,
          changesets: [
            {
              id: randomUUID(), deviceId, seq: 9, hlc, schemaVersion: 1,
              ops: [{ kind: 'put' as const, table: 'invoices', rowId: randomUUID(), fields: { total: 1 }, hlc }],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'sync.tabla_desconocida' } });
  }, 60_000);

  /**
   * El guard que impide que el agujero vuelva: una tabla nueva en `SyncTable` sin capacidad
   * asignada rompe acá. TypeScript ya lo exige con `Record<SyncTable, …>` completo; esto lo
   * verifica también en runtime, por si alguien lo relaja con un índice opcional.
   */
  it('TODA tabla del protocolo tiene capacidad de escritura declarada', () => {
    const tablas: SyncTable[] = [
      'animals', 'animal_movements', 'mortalities', 'pregnancies', 'weighings', 'weanings',
      'tasks', 'animal_events', 'vaccinations', 'treatments', 'breeding_events', 'calvings',
      'calving_offspring',
    ];
    for (const t of tablas) expect(CAPACIDAD_DE_ESCRITURA[t], `«${t}» sin capacidad`).toBeTruthy();
    // Y ninguna de más: una entrada que sobra es una tabla que se sacó del protocolo y quedó acá.
    expect(Object.keys(CAPACIDAD_DE_ESCRITURA).sort()).toEqual([...tablas].sort());
  });

  /**
   * La captura de campo del operario tiene que seguir entrando por sync. Si esta lista y la matriz
   * divergen, el móvil guarda offline algo que el servidor después rechaza — y el operario se
   * entera al volver la señal, con el trabajo del día ya hecho.
   */
  it('el operario puede sincronizar todo lo que captura en el corral', () => {
    const suyas: SyncTable[] = ['animals', 'animal_events', 'animal_movements', 'weighings', 'mortalities', 'tasks', 'vaccinations', 'treatments'];
    for (const t of suyas)
      expect(permite('worker', CAPACIDAD_DE_ESCRITURA[t], 'write'), `el operario no puede sincronizar «${t}»`).toBe(true);
  });

  /**
   * Y lo reproductivo lo VE pero no lo escribe. Es la mitad que importa de `reproduccion: 'read'`:
   * si además pudiera escribirlo, el permiso de lectura habría sido la puerta de entrada a
   * registrar servicios y diagnósticos, que es decisión clínica.
   */
  it('el operario ve reproducción pero no la escribe', () => {
    expect(permite('worker', 'reproduccion', 'read')).toBe(true);
    expect(permite('worker', 'reproduccion', 'write')).toBe(false);
    for (const t of ['pregnancies', 'calvings', 'weanings', 'breeding_events'] as SyncTable[])
      expect(permite('worker', CAPACIDAD_DE_ESCRITURA[t], 'write'), `el operario no debería escribir «${t}»`).toBe(false);
  });

  /**
   * El otro lado del mismo agujero: lo que el sync ENVÍA.
   *
   * `GET /animals` le devuelve 403 a un contador y el bootstrap le mandaba los 65 animales de la
   * finca igual, más lotes, tareas y el catálogo veterinario — 127 filas. Misma causa: el
   * interceptor autoriza la ruta y la ruta transporta cinco tablas.
   */
  it('el bootstrap NO le manda el hato a quien no puede leerlo', async () => {
    const delCapataz: any = await como('foreman', () => sync.bootstrap(deviceId));
    const tablasCapataz = new Set(delCapataz.rows.map((r: any) => r.table));
    expect(tablasCapataz.has('animals'), 'el capataz tiene que seguir recibiendo el hato').toBe(true);

    const delContador: any = await como('accountant', () => sync.bootstrap(deviceId));
    expect(delContador.rows, 'el contador no captura en el campo: no recibe nada').toEqual([]);

    /**
     * El operario recibe la preñez porque tiene `reproduccion: 'read'` (decisión 15 ago). Sin eso
     * la ficha del animal en el móvil le diría «Vacía» a una vaca preñada — mostrar de menos
     * miente, y en el corral es donde se decide.
     */
    const delOperario: any = await como('worker', () => sync.bootstrap(deviceId));
    const tablasOperario = new Set(delOperario.rows.map((r: any) => r.table));
    expect(tablasOperario.has('pregnancies'), 'el operario tiene que ver el estado de preñez').toBe(true);
    expect(tablasOperario.has('animals')).toBe(true);
    expect(tablasOperario.has('products_veterinary'), 'lo necesita para cargar una vacuna offline').toBe(true);
  }, 60_000);

  /**
   * El pull filtra las operaciones y DESCARTA los changesets que quedan vacíos, pero el cursor se
   * calcula sobre las filas crudas: el cliente recibe menos y avanza igual. Filtrar antes del
   * `LIMIT` habría dejado a un rol pidiendo el mismo cursor para siempre.
   */
  it('el pull filtra operaciones sin frenar el cursor', async () => {
    // Un SEGUNDO dispositivo: `pull` excluye a propósito los changesets que subió el mismo
    // aparato que pregunta, así que desde `deviceId` no se ven las operaciones de animales que él
    // mismo empujó en el primer test.
    const otro: any = await como('owner', () => sync.registerDevice({ platform: 'ios', device_name: 'segundo' }));
    const delCapataz: any = await como('foreman', () => sync.pull(otro.id, 0));
    const delContador: any = await como('accountant', () => sync.pull(otro.id, 0));

    const tablasDe = (r: any) => new Set(r.changesets.flatMap((c: any) => (c.ops ?? []).map((o: any) => o.table)));
    expect(tablasDe(delCapataz).has('animals')).toBe(true);
    expect(tablasDe(delContador).has('animals')).toBe(false);
    // El cursor avanza igual para los dos: no depende de lo que se filtró.
    expect(delContador.cursor).toBe(delCapataz.cursor);
  }, 60_000);

  /**
   * Quién puede usar el móvil para capturar, y quién no.
   *
   * El contador no puede escribir NINGUNA tabla del protocolo, y está bien: no captura en el
   * corral. Se afirma explícitamente en vez de dejarlo implícito, porque la consecuencia es real —
   * si instala la app, todo push le va a fallar. La app debería no ofrecerle la captura en vez de
   * dejarlo intentar; queda anotado como pendiente del móvil, no de la API.
   */
  it('los roles de campo pueden capturar; el contador no, y es a propósito', () => {
    const puedeAlgo = (rol: string) => Object.values(CAPACIDAD_DE_ESCRITURA).some((c) => permite(rol, c, 'write'));
    for (const rol of ['owner', 'admin', 'veterinarian', 'foreman', 'worker'])
      expect(puedeAlgo(rol), `${rol} no puede escribir ninguna tabla de sync`).toBe(true);
    expect(puedeAlgo('accountant'), 'el contador no captura en el campo').toBe(false);
    // Y la lista de roles no creció sin que este test se entere.
    expect(ROLES).toHaveLength(6);
  });

  /**
   * Dar de baja un dispositivo. La tabla y la aplicación ya existían —`status='revoked'`,
   * `assertDevice` rechazando, el plan contando solo `active`— y no había forma de llegar.
   */
  describe('baja de dispositivos', () => {
    const nuevoDevice = async (rol: string, quien = userId) =>
      (await requestContext.run({ userId: quien, tenantId, role: rol }, () =>
        sync.registerDevice({ platform: 'android', device_name: 'para dar de baja' }),
      )) as any;

    it('libera el lugar del plan, que es el motivo de existir de esto', async () => {
      const antes = await consumoDeDispositivos();
      const dev = await nuevoDevice('owner');
      expect(await consumoDeDispositivos()).toBe(antes + 1);

      await como('owner', () => sync.revokeDevice(dev.id));
      expect(await consumoDeDispositivos()).toBe(antes);
    }, 60_000);

    it('un dispositivo dado de baja deja de sincronizar', async () => {
      const dev = await nuevoDevice('owner');
      await como('owner', () => sync.revokeDevice(dev.id));

      // Las tres puertas del canal, no solo una.
      await expect(como('owner', () => sync.bootstrap(dev.id))).rejects.toMatchObject({
        response: { code: 'sync.device_revoked' },
      });
      await expect(como('owner', () => sync.pull(dev.id, 0))).rejects.toMatchObject({
        response: { code: 'sync.device_revoked' },
      });
      await expect(
        como('owner', () => sync.push({ ...pushDeAnimal('desde un revocado', 90), device_id: dev.id })),
      ).rejects.toMatchObject({ response: { code: 'sync.device_revoked' } });
    }, 60_000);

    /**
     * La regla que la ruta NO puede hacer cumplir: `sync/devices` cae bajo `sincronizacion`, que
     * todos los roles tienen porque sin ella el móvil no arranca. Sin esta comprobación un
     * operario le desconectaría el teléfono al veterinario.
     */
    it('nadie da de baja el dispositivo de otro, salvo el dueño y el administrador', async () => {
      const otroUser = (await db.query<{ id: string }>(`SELECT id FROM users WHERE id <> $1 LIMIT 1`, [userId]))[0];
      const ajeno = await nuevoDevice('owner', otroUser.id);

      await expect(como('worker', () => sync.revokeDevice(ajeno.id))).rejects.toMatchObject({
        response: { code: 'sync.device_ajeno' },
      });
      await expect(como('veterinarian', () => sync.revokeDevice(ajeno.id))).rejects.toMatchObject({
        response: { code: 'sync.device_ajeno' },
      });

      // El dueño sí: es el caso del empleado que se fue con la app instalada.
      await expect(como('owner', () => sync.revokeDevice(ajeno.id))).resolves.toMatchObject({ revoked: true });
    }, 60_000);

    it('cada quien da de baja el suyo sin depender de un administrador', async () => {
      const propio = await nuevoDevice('worker');
      await expect(como('worker', () => sync.revokeDevice(propio.id))).resolves.toMatchObject({ revoked: true });
    }, 60_000);

    it('es idempotente: darlo de baja dos veces no es un error', async () => {
      const dev = await nuevoDevice('owner');
      await expect(como('owner', () => sync.revokeDevice(dev.id))).resolves.toMatchObject({ already: false });
      await expect(como('owner', () => sync.revokeDevice(dev.id))).resolves.toMatchObject({ already: true });
    }, 60_000);

    it('un dispositivo de otra finca no existe para esta', async () => {
      await expect(como('owner', () => sync.revokeDevice(randomUUID()))).rejects.toMatchObject({
        response: { code: 'sync.device_not_found' },
      });
    }, 60_000);
  });

});
