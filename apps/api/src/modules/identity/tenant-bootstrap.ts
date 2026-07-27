import { BASE_CHART, chartRoleCodes, farmToday, initialFiscalPeriods, parentCode } from '@cowinance/domain';
import type { Q } from '../../db/db.service';

/**
 * Lo que una finca nueva necesita tener el primer día para poder trabajar.
 *
 * Hasta ahora el registro creaba usuario, organización, compañía y finca, y ahí terminaba. El
 * productor entraba a un sistema donde podía cargar un animal —los catálogos de especies, razas y
 * categorías son globales— pero donde **Finanzas estaba muerto**: la primera venta que intentara
 * asentarse se topaba con «La cuenta del rol 'receivable' no existe», sin ninguna pista de que
 * antes había que construir un plan de cuentas entero a mano.
 *
 * Acá se crea lo mínimo, y el criterio de "mínimo" no es estético: son las cuentas que el propio
 * `PostingService` declara necesitar, más el mapa que las conecta con los roles, más un depósito
 * para que el inventario tenga dónde entrar. Nada de esto es irreversible: las cuentas se editan
 * y el depósito se renombra como cualquier otro.
 *
 * **Corre DENTRO de la transacción del registro.** Si algo falla acá, no queda una finca a medio
 * armar: no queda finca. Es la diferencia entre un alta atómica y un tenant que hay que reparar a
 * mano sin saber en qué punto se cortó.
 */
export async function bootstrapTenant(
  q: Q,
  ids: { tenantId: string; companyId: string; farmId: string; userId: string; timeZone: string },
): Promise<void> {
  await crearPlanDeCuentas(q, ids);
  await crearPeriodosFiscales(q, ids);
  await crearDepositoPorDefecto(q, ids);
}

/**
 * El plan de cuentas base, con los padres resueltos por código.
 *
 * Se inserta en el orden de `BASE_CHART`, que el dominio garantiza que trae a cada padre antes que
 * a sus hijos: así el `parent_id` ya está resuelto cuando hace falta, sin una segunda pasada.
 */
async function crearPlanDeCuentas(
  q: Q,
  { tenantId, companyId, userId }: { tenantId: string; companyId: string; userId: string },
): Promise<void> {
  const idPorCodigo = new Map<string, string>();

  for (const cuenta of BASE_CHART) {
    const padre = parentCode(cuenta.code);
    const fila = (await q.one<{ id: string }>(
      `INSERT INTO chart_of_accounts (tenant_id, company_id, code, name, type, parent_id, is_postable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        tenantId,
        companyId,
        cuenta.code,
        cuenta.name,
        cuenta.type,
        padre === null ? null : (idPorCodigo.get(padre) ?? null),
        cuenta.postable,
        userId,
      ],
    ))!;
    idPorCodigo.set(cuenta.code, fila.id);
  }

  // El mapa rol→cuenta que `PostingService` lee de `system_settings`. Sin él, las cuentas existirían
  // pero el asiento automático seguiría sin saber cuál usar para cada cosa: crear el plan y no
  // cablearlo dejaría el mismo error, solo que más difícil de entender.
  const mapa: Record<string, string> = {};
  for (const [rol, codigo] of Object.entries(chartRoleCodes())) mapa[rol] = idPorCodigo.get(codigo)!;

  await q.query(
    `INSERT INTO system_settings (tenant_id, key, value, scope, scope_id, created_by)
     VALUES ($1,'finance.posting_accounts',$2,'company',$3,$4)`,
    [tenantId, JSON.stringify(mapa), companyId, userId],
  );
}

/**
 * Los períodos fiscales, sin los cuales el mayor no acepta un solo asiento.
 *
 * El año se toma del **día de la finca**, no del reloj del servidor: una finca en Venezuela que se
 * registra el 31 de diciembre a las 21:00 está en el año que termina, no en el que empieza. Es el
 * mismo motivo por el que existe `farmToday`, aplicado al caso donde equivocarse cuesta más — el
 * año contable entero.
 */
async function crearPeriodosFiscales(
  q: Q,
  { tenantId, companyId, userId, timeZone }: { tenantId: string; companyId: string; userId: string; timeZone: string },
): Promise<void> {
  const año = Number(farmToday(timeZone).slice(0, 4));
  for (const p of initialFiscalPeriods(año)) {
    await q.query(
      `INSERT INTO fiscal_periods (tenant_id, company_id, name, start_date, end_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'open',$6)`,
      [tenantId, companyId, p.name, p.start_date, p.end_date, userId],
    );
  }
}

/**
 * Un depósito, para que el inventario tenga dónde entrar.
 *
 * Se crea UNO y no varios a propósito: mientras haya un solo depósito, la entrega de una venta no
 * puede elegir mal. Con varios, hoy elige el más antiguo sin mirar si tiene saldo — una limitación
 * conocida y anotada aparte, que no conviene estrenar el primer día de un productor.
 */
async function crearDepositoPorDefecto(
  q: Q,
  { tenantId, farmId, userId }: { tenantId: string; farmId: string; userId: string },
): Promise<void> {
  await q.query(`INSERT INTO warehouses (tenant_id, farm_id, name, created_by) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    farmId,
    'Depósito principal',
    userId,
  ]);
}
