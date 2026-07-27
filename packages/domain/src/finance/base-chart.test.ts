import { describe, expect, it } from 'vitest';
import { BASE_CHART, POSTING_ROLES, chartRoleCodes, parentCode } from './base-chart';

/**
 * Estos tests existen para que el plan base no se desincronice del código que lo consume.
 *
 * Un plan de cuentas incompleto no falla al crearse: falla meses después, cuando el productor
 * factura por primera vez y el asiento no cierra. Acá se verifica antes.
 */
describe('el plan de cuentas con el que arranca una finca', () => {
  const porCodigo = new Map(BASE_CHART.map((a) => [a.code, a]));

  it('CUBRE TODOS LOS ROLES DE POSTEO QUE EL SISTEMA EXIGE', () => {
    // El invariante que importa: si mañana se agrega un rol en PostingService y nadie toca el plan,
    // esto falla acá y no en la primera venta de un cliente.
    const cubiertos = chartRoleCodes();
    for (const rol of POSTING_ROLES) expect(cubiertos[rol], `falta cuenta para el rol '${rol}'`).toBeTruthy();
    expect(Object.keys(cubiertos).sort()).toEqual([...POSTING_ROLES].sort());
  });

  it('cada rol lo cubre UNA sola cuenta', () => {
    // Dos cuentas para el mismo rol es una ambigüedad silenciosa: el asiento saldría a una u otra
    // según el orden de la lista.
    const conRol = BASE_CHART.filter((a) => a.role).map((a) => a.role);
    expect(new Set(conRol).size).toBe(conRol.length);
  });

  it('LAS CUENTAS DE ROL SON IMPUTABLES', () => {
    // `PostingService` rechaza explícitamente una cuenta no imputable. Un plan que entregue un
    // título como cuenta de rol dejaría el posteo roto desde el día uno.
    for (const a of BASE_CHART.filter((x) => x.role)) expect(a.postable, `'${a.code}' es de rol y no es imputable`).toBe(true);
  });

  it('TODO PADRE REFERENCIADO EXISTE', () => {
    // El código es jerárquico: `5.3.01` cuelga de `5.3`. Si el título falta, la cuenta queda
    // huérfana y el árbol de Finanzas se dibuja incompleto.
    for (const a of BASE_CHART) {
      const padre = parentCode(a.code);
      if (padre !== null) expect(porCodigo.has(padre), `'${a.code}' cuelga de '${padre}', que no existe`).toBe(true);
    }
  });

  it('un padre nunca es imputable, y su tipo es el del hijo', () => {
    // Asentar contra un título duplicaría el saldo (en el título y en la hoja). Y un hijo de otro
    // tipo que el padre haría que el balance sume peras con manzanas.
    for (const a of BASE_CHART) {
      const padre = parentCode(a.code);
      if (padre === null) continue;
      expect(porCodigo.get(padre)!.postable, `'${padre}' es padre y es imputable`).toBe(false);
      expect(porCodigo.get(padre)!.type).toBe(a.type);
    }
  });

  it('no hay códigos repetidos', () => {
    // La tabla tiene UNIQUE (company_id, code): un duplicado haría fallar el alta entera.
    expect(new Set(BASE_CHART.map((a) => a.code)).size).toBe(BASE_CHART.length);
  });

  it('los padres vienen ANTES que sus hijos', () => {
    // El alta inserta en orden y necesita el `parent_id` ya resuelto.
    const vistos = new Set<string>();
    for (const a of BASE_CHART) {
      const padre = parentCode(a.code);
      if (padre !== null) expect(vistos.has(padre), `'${a.code}' aparece antes que su padre '${padre}'`).toBe(true);
      vistos.add(a.code);
    }
  });

  it('el tipo de cada grupo es el que dice su número', () => {
    // 1 activo, 2 pasivo, 3 patrimonio, 4 ingresos, 5 egresos: la convención que reconoce cualquier
    // contador que el productor contrate después.
    const esperado: Record<string, string> = { '1': 'asset', '2': 'liability', '3': 'equity', '4': 'income', '5': 'expense' };
    for (const a of BASE_CHART) expect(a.type).toBe(esperado[a.code[0]]);
  });

  it('tiene semovientes: es un plan GANADERO, no uno genérico', () => {
    // El hato es capital de trabajo. Un plan que lo trate como gasto le miente al productor sobre
    // cuánto vale su finca.
    const semovientes = BASE_CHART.find((a) => a.name.toLowerCase().includes('semovientes'));
    expect(semovientes?.type).toBe('asset');
    expect(semovientes?.postable).toBe(true);
  });
});
