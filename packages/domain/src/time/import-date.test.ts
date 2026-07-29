import { describe, expect, it } from 'vitest';
import { parseImportDate } from './import-date';

/** Un «hoy» fijo: qué es futuro depende del día, y un test no puede depender del reloj. */
const HOY = '2026-07-29';
const fecha = (v: unknown) => {
  const r = parseImportDate(v, HOY);
  return r.ok ? r.date : `RECHAZADA: ${r.reason}`;
};

describe('la fecha que viene en una planilla', () => {
  it('DÍA PRIMERO, no mes: es la decisión que cambia datos', () => {
    // Antes el texto viajaba crudo a Postgres y `05/06/2022` se leía a la manera estadounidense:
    // quedaba 6 de mayo cuando el productor escribió 5 de junio. Un mes de diferencia no chilla,
    // pero corre la edad, la ventana de destete y la categoría por edad.
    expect(fecha('05/06/2022')).toBe('2022-06-05');
    expect(fecha('01/12/2022'), 'primero de diciembre, no 12 de enero').toBe('2022-12-01');
  });

  it('los formatos que de verdad se usan acá entran', () => {
    // `14/03/2022` colgaba la importación entera: Postgres lo rechazaba, el chunk se revertía y el
    // lote reintentaba para siempre.
    expect(fecha('2022-03-14')).toBe('2022-03-14');
    expect(fecha('14/03/2022')).toBe('2022-03-14');
    expect(fecha('14-03-2022')).toBe('2022-03-14');
    expect(fecha('14.03.2022')).toBe('2022-03-14');
    expect(fecha('14/3/2022'), 'sin cero adelante').toBe('2022-03-14');
    expect(fecha('14/3/22'), 'año de dos dígitos').toBe('2022-03-14');
  });

  it('una celda vacía es válida: no todos saben cuándo nació', () => {
    expect(fecha('')).toBeNull();
    expect(fecha('   ')).toBeNull();
    expect(fecha(null)).toBeNull();
    expect(fecha(undefined)).toBeNull();
  });

  it('lo que NO es una fecha se rechaza NOMBRANDO la celda', () => {
    // `marzo 2022` pasaba la vista previa como «válida» y reventaba en el commit, matando el chunk
    // entero. El mensaje tiene que decir qué celda, o el productor no la encuentra en 3.000 filas.
    expect(fecha('marzo 2022')).toMatch(/«marzo 2022» no es una fecha/);
    expect(fecha('s/d')).toMatch(/«s\/d»/);
    expect(fecha('31/02/2022'), 'febrero no tiene 31').toMatch(/no es una fecha que exista/);
  });

  it('un número pelado se rechaza en vez de adivinar', () => {
    // `44634` es una fecha de Excel sin formatear y traducirla sería una línea. No se hace: «2022»
    // también es un número pelado y se volvería 1975 sin que nadie se entere. Un rechazo que se
    // entiende es mejor que un dato callado que está mal.
    expect(fecha('44634')).toMatch(/es un número, no una fecha/);
    expect(fecha('2022')).toMatch(/es un número, no una fecha/);
  });

  it('una planilla en mes/día se detecta y se explica cómo arreglarla', () => {
    // No alcanza con «fecha inválida»: el productor tiene que saber que el problema es la COLUMNA
    // entera y no esa celda.
    const r = fecha('03/14/2022');
    expect(r).toMatch(/formato mes\/día/);
    expect(r, 'dice cómo se escribe').toMatch(/14\/03\/2022/);
  });

  it('una fecha de nacimiento futura se rechaza', () => {
    // Un animal no puede haber nacido todavía. Se atrapa en la vista previa —donde la planilla
    // todavía se puede corregir— y no al medio de un commit de 3.000 filas.
    expect(fecha('2030-01-01')).toMatch(/futura/);
    expect(fecha('30/01/2030')).toMatch(/futura/);
    expect(fecha(HOY), 'hoy mismo vale: un ternero puede haber nacido esta mañana').toBe(HOY);
  });

  it('el año de dos dígitos elige el siglo con sentido', () => {
    expect(fecha('14/03/22')).toBe('2022-03-14');
    expect(fecha('14/03/95'), 'del 70 para arriba es el siglo pasado').toBe('1995-03-14');
  });

  it('los espacios de sobra no rompen nada', () => {
    expect(fecha('  14/03/2022  ')).toBe('2022-03-14');
  });
});
