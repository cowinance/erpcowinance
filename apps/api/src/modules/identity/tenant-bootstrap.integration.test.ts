import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { CommerceService } from '../commerce/commerce.service';
import { PurchasesService } from '../commerce/purchases.service';
import { SalesService } from '../commerce/sales.service';
import { AccountsService } from '../finance/accounts.service';
import { LedgerService } from '../finance/ledger.service';
import { PostingService } from '../finance/posting.service';
import { POSTING_ROLES } from '@cowinance/domain';
import { bootstrapTenant } from './tenant-bootstrap';

/**
 * Lo que recibe una finca el primer día (O-1).
 *
 * Antes, un tenant recién registrado tenía usuario, organización, compañía y finca — y nada más.
 * Podía cargar un animal, pero **Finanzas estaba muerto**: la primera venta que intentara asentarse
 * chocaba contra «La cuenta del rol 'receivable' no existe» y, superado eso, contra «No hay un
 * período fiscal abierto». Dos paredes que le piden al productor saber contabilidad antes de haber
 * vendido un novillo.
 */
describe('una finca nueva arranca operable', () => {
  let db: DbService;
  let originalCwd: string;
  let tmp: string;
  let nuevo: { tenantId: string; companyId: string; farmId: string; userId: string };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'bootstrap-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();

    // Un tenant virgen, creado como lo crea el registro: sin catálogos propios ni nada cargado.
    nuevo = await db.tx(async (q) => {
      const user = (await q.one<{ id: string }>(
        `INSERT INTO users (email, full_name, locale, password_hash) VALUES ($1,'Productor Nuevo','es-VE','x') RETURNING id`,
        [`nuevo${Date.now()}@ejemplo.com`],
      ))!;
      const org = (await q.one<{ id: string }>(
        `INSERT INTO organizations (name, legal_name, country_code, default_currency, default_locale, timezone, created_by)
         VALUES ('Hacienda Nueva','Hacienda Nueva','VE','USD','es-VE','America/Caracas',$1) RETURNING id`,
        [user.id],
      ))!;
      await q.query(`SELECT set_config('app.tenant_id', $1, true)`, [org.id]);
      const company = (await q.one<{ id: string }>(
        `INSERT INTO companies (tenant_id, name, country_code, functional_currency, created_by)
         VALUES ($1,'Hacienda Nueva','VE','USD',$2) RETURNING id`,
        [org.id, user.id],
      ))!;
      const farm = (await q.one<{ id: string }>(
        `INSERT INTO farms (tenant_id, company_id, name, timezone, created_by) VALUES ($1,$2,'Fundo Principal','America/Caracas',$3) RETURNING id`,
        [org.id, company.id, user.id],
      ))!;
      const ids = { tenantId: org.id, companyId: company.id, farmId: farm.id, userId: user.id };
      await bootstrapTenant(q, { ...ids, timeZone: 'America/Caracas' });
      return ids;
    });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('TIENE UNA CUENTA PARA CADA ROL QUE EL POSTEO EXIGE, Y TODAS IMPUTABLES', async () => {
    // El invariante que hace que la primera venta pueda asentarse. Se comprueba contra la base y no
    // contra la constante del dominio: lo que importa es que las filas existan de verdad.
    const mapa = (await db.one<{ value: Record<string, string> }>(
      `SELECT value FROM system_settings WHERE tenant_id=$1 AND key='finance.posting_accounts' AND scope_id=$2`,
      [nuevo.tenantId, nuevo.companyId],
    ))!.value;

    for (const rol of POSTING_ROLES) {
      const cuenta = await db.one<{ is_postable: boolean }>(
        `SELECT is_postable FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2`,
        [mapa[rol], nuevo.tenantId],
      );
      expect(cuenta, `el rol '${rol}' no apunta a ninguna cuenta`).toBeTruthy();
      expect(cuenta!.is_postable, `la cuenta del rol '${rol}' no es imputable`).toBe(true);
    }
  });

  it('los títulos del plan NO son imputables', async () => {
    // Asentar contra un título duplicaría el saldo: una vez en el título y otra en la hoja.
    const titulos = await db.query<{ code: string }>(
      `SELECT code FROM chart_of_accounts WHERE tenant_id=$1 AND is_postable = false ORDER BY code`,
      [nuevo.tenantId],
    );
    expect(titulos.length).toBeGreaterThan(0);
    expect(titulos.map((t) => t.code)).toContain('1');
  });

  it('cada cuenta cuelga de su padre', async () => {
    // Si el `parent_id` quedara sin resolver, el árbol de Finanzas se dibuja plano y los subtotales
    // por grupo no suman.
    const huerfanas = await db.query<{ code: string }>(
      `SELECT code FROM chart_of_accounts WHERE tenant_id=$1 AND parent_id IS NULL AND code LIKE '%.%'`,
      [nuevo.tenantId],
    );
    expect(huerfanas.map((h) => h.code)).toEqual([]);
  });

  it('tiene períodos fiscales abiertos que cubren dos años sin huecos', async () => {
    // Con un solo año, el 1 de enero toda la contabilidad deja de asentar de golpe.
    const p = await db.query<{ name: string; status: string }>(
      `SELECT name, status FROM fiscal_periods WHERE tenant_id=$1 ORDER BY start_date`,
      [nuevo.tenantId],
    );
    expect(p).toHaveLength(24);
    expect(p.every((x) => x.status === 'open')).toBe(true);
  });

  it('tiene UN depósito, para que el inventario tenga dónde entrar', async () => {
    // Uno y no varios: mientras haya uno solo, la entrega de una venta no puede elegir mal.
    const w = await db.query<{ name: string }>(`SELECT name FROM warehouses WHERE tenant_id=$1`, [nuevo.tenantId]);
    expect(w).toHaveLength(1);
  });

  it('el alta es ATÓMICA: si algo falla, no queda una finca a medio armar', async () => {
    // Media finca es peor que ninguna: hay que repararla a mano sin saber en qué punto se cortó.
    const antes = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM chart_of_accounts`))!.n;
    await expect(
      db.tx(async (q) => {
        await bootstrapTenant(q, {
          tenantId: nuevo.tenantId,
          companyId: nuevo.companyId,
          farmId: nuevo.farmId,
          userId: nuevo.userId,
          timeZone: 'America/Caracas',
        });
        // El segundo alta sobre la misma company choca con UNIQUE (company_id, code).
      }),
    ).rejects.toThrow();
    const despues = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM chart_of_accounts`))!.n;
    expect(despues).toBe(antes);
  });
});

/**
 * El mes contable de un asiento.
 *
 * `sale_date` es una FECHA CALENDARIO y vuelve de la base como objeto `Date` (medianoche UTC). Si en
 * el camino a la búsqueda del período se la interpretara como un instante en la zona del proceso,
 * una venta del día 1 se correría al último día del mes ANTERIOR — y como los períodos son
 * contiguos, el asiento no fallaría: entraría, callado, en el mes equivocado. Un error que no se
 * ve hasta que no cuadra el cierre.
 */
describe('una venta del día 1 cae en SU mes, no en el anterior', () => {
  let db: DbService;
  let posting: PostingService;
  let accounts: AccountsService;
  let commerce: CommerceService;
  let sales: SalesService;
  let originalCwd: string;
  let tmp: string;
  let customerId: string;
  let itemId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'periodo-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const inv = new InventoryService(db);
    accounts = new AccountsService(db);
    const ledger = new LedgerService(db);
    commerce = new CommerceService(db);
    sales = new SalesService(db, inv, new AnimalStatusService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    posting = new PostingService(db, accounts, ledger, new PurchasesService(db, inv), sales);

    const mk = async (code: string, name: string, type: string) => ((await accounts.createAccount({ code, name, type })) as any).id;
    await posting.setPostingAccounts({
      receivable: await mk('1.1.02', 'Deudores', 'asset'),
      sales_income: await mk('4.1.01', 'Ventas', 'income'),
      vat_debit: await mk('2.1.01', 'IVA débito', 'liability'),
    });
    // Dos meses CONSECUTIVOS: es la única forma de que un corrimiento de un día se note.
    await accounts.createPeriod({ name: 'Julio 2030', start_date: '2030-07-01', end_date: '2030-07-31' });
    await accounts.createPeriod({ name: 'Agosto 2030', start_date: '2030-08-01', end_date: '2030-08-31' });

    const cust: any = await commerce.createPartner({ type: 'customer', name: 'Frigorífico', customer_segment: 'retail' });
    customerId = cust.id;
    const item: any = await inv.createItem({ name: 'Novillo', unit: 'kg' });
    itemId = item.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const periodoDeLaVentaDel = async (fecha: string): Promise<string> => {
    const venta: any = await sales.create({
      customer_partner_id: customerId,
      type: 'product',
      sale_date: fecha,
      lines: [{ item_id: itemId, quantity: 1, unit_price: 100 }],
    });
    const res: any = await posting.postDocument('sale', venta.id);
    const fila = await db.one<{ name: string }>(
      `SELECT p.name FROM journal_entries e JOIN fiscal_periods p ON p.id = e.period_id WHERE e.id = $1`,
      [res.journal_entry_id],
    );
    return fila!.name;
  };

  it('EL 1 DE AGOSTO ES DE AGOSTO', async () => {
    expect(await periodoDeLaVentaDel('2030-08-01')).toBe('Agosto 2030');
  });

  it('el 31 de julio sigue siendo de julio', async () => {
    // El otro borde: si algo corriera las fechas hacia adelante, éste se iría a agosto.
    expect(await periodoDeLaVentaDel('2030-07-31')).toBe('Julio 2030');
  });

  it('un día del medio del mes no prueba nada, y por eso no alcanza con probarlo', async () => {
    expect(await periodoDeLaVentaDel('2030-07-15')).toBe('Julio 2030');
  });
});
