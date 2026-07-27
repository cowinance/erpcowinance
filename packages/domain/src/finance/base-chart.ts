/**
 * El plan de cuentas con el que arranca una finca nueva.
 *
 * Sin esto, un tenant recién registrado tiene el módulo de Finanzas muerto: la primera venta que
 * intenta asentarse no encuentra ninguna cuenta, y el productor —que compró un sistema para
 * ganado, no para aprender contabilidad— se topa con «La cuenta del rol 'receivable' no existe»
 * antes de haber cargado un animal.
 *
 * **De dónde sale este plan.** No es contabilidad inventada: el sistema declara en `PostingService`
 * los roles que necesita para armar un asiento balanceado (cobrar una venta, pagar una compra,
 * liquidar un sueldo). Cada uno de esos roles tiene acá su cuenta, y el test lo verifica en los dos
 * sentidos: ningún rol sin cuenta, ninguna cuenta de rol que no sea imputable. Si mañana se agrega
 * un rol de posteo y nadie toca este archivo, la suite falla en vez de descubrirse en producción
 * con una venta que no cierra.
 *
 * **Es un punto de partida, no un corsé.** Las cuentas quedan como cualquier otra: se editan, se
 * agregan y se desactivan desde Finanzas. La estructura es la mínima usable de una explotación
 * ganadera —con semovientes como activo, que es lo que distingue a este plan de uno genérico—.
 *
 * Puro, sin IO: la lista es dato, y quien la persiste es el servicio de alta.
 */

// El mismo tipo que ya usa el mayor: se importa, no se vuelve a declarar.
import type { AccountType } from './budget-variance';

/** Los roles que `PostingService` necesita para armar un asiento. Si crece, este archivo también. */
export const POSTING_ROLES = [
  'receivable',
  'sales_income',
  'vat_debit',
  'purchases',
  'vat_credit',
  'payable',
  'cash',
  'salary_expense',
  'salaries_payable',
  'payroll_withholdings',
] as const;

export type PostingRole = (typeof POSTING_ROLES)[number];

export interface BaseAccount {
  /** Código jerárquico: el prefijo antes del último punto es el del padre. */
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /**
   * `false` en los títulos (Activo, Pasivo…). Un asiento contra un título rompe el mayor: los
   * saldos se acumularían dos veces, en el título y en la hoja.
   */
  readonly postable: boolean;
  /** El rol de posteo que cubre, si cubre alguno. */
  readonly role?: PostingRole;
}

/**
 * Cinco grupos, títulos no imputables y hojas imputables.
 *
 * La numeración sigue la convención de la región (1 activo, 2 pasivo, 3 patrimonio, 4 ingresos,
 * 5 egresos), que es la que reconoce cualquier contador que el productor contrate después.
 */
export const BASE_CHART: readonly BaseAccount[] = [
  // ── 1 · Activo ──────────────────────────────────────────────────────────────
  { code: '1', name: 'Activo', type: 'asset', postable: false },
  { code: '1.1', name: 'Activo circulante', type: 'asset', postable: false },
  { code: '1.1.01', name: 'Caja y bancos', type: 'asset', postable: true, role: 'cash' },
  { code: '1.1.02', name: 'Cuentas por cobrar comerciales', type: 'asset', postable: true, role: 'receivable' },
  { code: '1.1.03', name: 'IVA crédito fiscal', type: 'asset', postable: true, role: 'vat_credit' },
  { code: '1.1.04', name: 'Inventarios (insumos y medicamentos)', type: 'asset', postable: true },
  { code: '1.2', name: 'Activo no circulante', type: 'asset', postable: false },
  // Lo que hace ganadero a este plan: el hato es capital de trabajo, no un gasto.
  { code: '1.2.01', name: 'Semovientes (hato)', type: 'asset', postable: true },
  { code: '1.2.02', name: 'Tierras y mejoras', type: 'asset', postable: true },
  { code: '1.2.03', name: 'Maquinaria y equipos', type: 'asset', postable: true },

  // ── 2 · Pasivo ──────────────────────────────────────────────────────────────
  { code: '2', name: 'Pasivo', type: 'liability', postable: false },
  { code: '2.1', name: 'Pasivo circulante', type: 'liability', postable: false },
  { code: '2.1.01', name: 'Cuentas por pagar comerciales', type: 'liability', postable: true, role: 'payable' },
  { code: '2.1.02', name: 'IVA débito fiscal', type: 'liability', postable: true, role: 'vat_debit' },
  { code: '2.1.03', name: 'Sueldos y salarios por pagar', type: 'liability', postable: true, role: 'salaries_payable' },
  { code: '2.1.04', name: 'Retenciones de nómina por pagar', type: 'liability', postable: true, role: 'payroll_withholdings' },

  // ── 3 · Patrimonio ──────────────────────────────────────────────────────────
  { code: '3', name: 'Patrimonio', type: 'equity', postable: false },
  { code: '3.1', name: 'Capital social', type: 'equity', postable: false },
  { code: '3.1.01', name: 'Capital', type: 'equity', postable: true },
  { code: '3.2', name: 'Resultados', type: 'equity', postable: false },
  { code: '3.2.01', name: 'Resultados acumulados', type: 'equity', postable: true },

  // ── 4 · Ingresos ────────────────────────────────────────────────────────────
  { code: '4', name: 'Ingresos', type: 'income', postable: false },
  { code: '4.1', name: 'Ingresos de explotación', type: 'income', postable: false },
  { code: '4.1.01', name: 'Venta de ganado', type: 'income', postable: true, role: 'sales_income' },
  { code: '4.1.02', name: 'Venta de leche', type: 'income', postable: true },
  { code: '4.1.03', name: 'Venta de cosechas', type: 'income', postable: true },
  { code: '4.9', name: 'Otros ingresos', type: 'income', postable: false },
  { code: '4.9.01', name: 'Otros ingresos', type: 'income', postable: true },

  // ── 5 · Egresos ─────────────────────────────────────────────────────────────
  { code: '5', name: 'Egresos', type: 'expense', postable: false },
  { code: '5.1', name: 'Costo de ventas', type: 'expense', postable: false },
  { code: '5.1.01', name: 'Compras', type: 'expense', postable: true, role: 'purchases' },
  { code: '5.2', name: 'Gastos de personal', type: 'expense', postable: false },
  { code: '5.2.01', name: 'Sueldos y salarios', type: 'expense', postable: true, role: 'salary_expense' },
  { code: '5.3', name: 'Gastos de explotación', type: 'expense', postable: false },
  { code: '5.3.01', name: 'Alimentación y nutrición', type: 'expense', postable: true },
  { code: '5.3.02', name: 'Sanidad y veterinaria', type: 'expense', postable: true },
  { code: '5.3.03', name: 'Combustible y mantenimiento', type: 'expense', postable: true },
  { code: '5.3.04', name: 'Servicios y arrendamientos', type: 'expense', postable: true },
  { code: '5.9', name: 'Otros gastos', type: 'expense', postable: false },
  { code: '5.9.01', name: 'Otros gastos', type: 'expense', postable: true },
];

/** El código del padre de una cuenta según su código, o `null` si es de primer nivel. */
export function parentCode(code: string): string | null {
  const i = code.lastIndexOf('.');
  return i === -1 ? null : code.slice(0, i);
}

/** Rol de posteo → código de cuenta, para armar el mapa que consume `PostingService`. */
export function chartRoleCodes(): Record<PostingRole, string> {
  const mapa = {} as Record<PostingRole, string>;
  for (const a of BASE_CHART) if (a.role) mapa[a.role] = a.code;
  return mapa;
}
