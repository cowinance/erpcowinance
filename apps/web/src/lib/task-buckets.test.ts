import { describe, expect, it } from 'vitest';
import { bucketForDue, endOfMonth } from './task-buckets';

/**
 * Las fronteras del tablero de tareas.
 *
 * Son todas comparaciones de fecha, que es donde se esconden los errores de un día: el bug que
 * originó este módulo era mezclar el día de la finca con fechas de UTC, y en un huso negativo eso
 * corría «próximos 7 días» y «este mes» después de las 20:00. Acá el día entra por parámetro, así
 * que los bordes se pueden afirmar en vez de esperar a que alguien los note en el campo.
 */
const HOY = '2026-05-20';

describe('bucketForDue', () => {
  it('sin fecha va a «sin fecha», que no es lo mismo que vencida', () => {
    expect(bucketForDue(null, HOY)).toBe('nodate');
    expect(bucketForDue(undefined, HOY)).toBe('nodate');
    expect(bucketForDue('', HOY)).toBe('nodate');
  });

  it('ayer está vencida y hoy es hoy', () => {
    expect(bucketForDue('2026-05-19', HOY)).toBe('overdue');
    expect(bucketForDue('2026-05-20', HOY)).toBe('today');
  });

  /** El borde que más importa: una tarea de hoy no puede aparecer como vencida. */
  it('el día de hoy nunca cae en vencidas', () => {
    expect(bucketForDue('2026-05-20T23:59:00Z', HOY)).toBe('today');
  });

  it('mañana y el séptimo día entran en «próximos 7»', () => {
    expect(bucketForDue('2026-05-21', HOY)).toBe('next7');
    expect(bucketForDue('2026-05-27', HOY)).toBe('next7');
  });

  it('el octavo día ya no', () => {
    expect(bucketForDue('2026-05-28', HOY)).toBe('month');
  });

  it('el resto del mes es «este mes», y el mes siguiente es «más adelante»', () => {
    expect(bucketForDue('2026-05-31', HOY)).toBe('month');
    expect(bucketForDue('2026-06-01', HOY)).toBe('later');
    expect(bucketForDue('2027-01-01', HOY)).toBe('later');
  });

  /** Con un `due` que trae hora, solo cuenta el día. */
  it('ignora la hora del vencimiento', () => {
    expect(bucketForDue('2026-05-19T23:00:00Z', HOY)).toBe('overdue');
    expect(bucketForDue('2026-05-21T00:00:00Z', HOY)).toBe('next7');
  });

  /**
   * Si «hoy» cae cerca de fin de mes, la ventana de siete días se mete en el mes siguiente. Eso
   * tiene que seguir siendo «próximos 7» y no «más adelante»: lo urgente manda sobre el almanaque.
   */
  it('la ventana de siete días gana cuando cruza el fin de mes', () => {
    expect(bucketForDue('2026-06-02', '2026-05-29')).toBe('next7');
    // Pasados esos siete días vuelve a mandar el almanaque: junio no es «este mes» estando en mayo.
    expect(bucketForDue('2026-06-06', '2026-05-29')).toBe('later');
  });

  it('el último día del año no rompe el cruce de mes', () => {
    expect(bucketForDue('2027-01-03', '2026-12-28')).toBe('next7');
    expect(bucketForDue('2027-02-01', '2026-12-28')).toBe('later');
  });
});

describe('endOfMonth', () => {
  it('conoce la cantidad de días de cada mes', () => {
    expect(endOfMonth('2026-01-15')).toBe('2026-01-31');
    expect(endOfMonth('2026-04-01')).toBe('2026-04-30');
    expect(endOfMonth('2026-12-25')).toBe('2026-12-31');
  });

  it('conoce los años bisiestos', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  /**
   * Se calcula en UTC a propósito. El cálculo viejo armaba una fecha LOCAL y la pasaba por
   * `toISOString()`: en un huso positivo, la medianoche local es el día anterior en UTC y el fin
   * de mes salía un día antes.
   */
  it('no depende de la zona del equipo', () => {
    expect(endOfMonth('2026-05-20')).toBe('2026-05-31');
    expect(endOfMonth('2026-05-31')).toBe('2026-05-31');
    expect(endOfMonth('2026-05-01')).toBe('2026-05-31');
  });
});
