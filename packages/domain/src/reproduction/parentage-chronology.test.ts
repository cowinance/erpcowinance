import { describe, expect, it } from 'vitest';
import { GESTATION_DAYS } from './gestation';
import { parentageChronologyIssue } from './parentage-chronology';

/** Suma o resta días sobre una fecha calendario, para armar los casos. */
const dia = (base: string, n: number) => new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const CRIA = '2020-06-01';

describe('un progenitor no puede haber nacido después que su cría', () => {
  it('el caso que se aceptaba: madre nacida OCHO AÑOS después que su hija', () => {
    // Comprobado contra la app antes del arreglo. El sistema verificaba existencia, sexo y ciclos,
    // pero no las fechas.
    const r = parentageChronologyIssue('2025-12-05', '2017-08-08');
    expect(r).not.toBeNull();
    expect(r!.message).toMatch(/nació DESPUÉS que la cría/);
  });

  it('NACER ANTES NO ALCANZA: tuvo que existir en la concepción', () => {
    // Es el punto de la regla. Una madre nacida cien días antes que su cría tampoco pudo gestarla:
    // el piso no es «antes», es una gestación antes.
    expect(parentageChronologyIssue(dia(CRIA, -100), CRIA), 'cien días antes es imposible').not.toBeNull();
    expect(parentageChronologyIssue(dia(CRIA, -1), CRIA)).not.toBeNull();
  });

  it('el borde cae EXACTAMENTE en la gestación', () => {
    // Un día menos es imposible; justo la gestación, no. El piso es la constante compartida con el
    // intervalo entre partos, no un número elegido aparte.
    expect(parentageChronologyIssue(dia(CRIA, -(GESTATION_DAYS - 1)), CRIA), 'un día menos').not.toBeNull();
    expect(parentageChronologyIssue(dia(CRIA, -GESTATION_DAYS), CRIA), 'justo la gestación').toBeNull();
    expect(parentageChronologyIssue(dia(CRIA, -(GESTATION_DAYS + 1)), CRIA)).toBeNull();
  });

  it('una madre de verdad pasa sin ruido', () => {
    expect(parentageChronologyIssue('2015-03-10', CRIA)).toBeNull();
  });

  it('SIN FECHA NO SE VALIDA NADA', () => {
    // Un animal comprado sin fecha de nacimiento es lo más normal del mundo. Rechazar su genealogía
    // por un dato que nadie tiene sería peor que el problema que la regla resuelve.
    expect(parentageChronologyIssue(null, CRIA)).toBeNull();
    expect(parentageChronologyIssue('2015-03-10', null)).toBeNull();
    expect(parentageChronologyIssue(undefined, undefined)).toBeNull();
  });

  it('el mensaje nombra las DOS fechas y la relación', () => {
    // Sin las dos fechas el productor no sabe cuál corregir; sin la relación no sabe cuál de los dos
    // progenitores está mal.
    const r = parentageChronologyIssue('2020-05-01', CRIA, 'padre')!;
    expect(r.message).toContain('2020-05-01');
    expect(r.message).toContain(CRIA);
    expect(r.message).toMatch(/^El padre|padre \(/);
  });

  it('dice cuántos días le faltan, para poder ordenar por gravedad', () => {
    const r = parentageChronologyIssue(dia(CRIA, -(GESTATION_DAYS - 10)), CRIA)!;
    expect(r.shortByDays).toBe(10);
  });

  it('una fecha con formato roto no rompe ni bloquea', () => {
    // Validar el formato es de otro. Trabarse acá dejaría al productor sin poder cargar por un motivo
    // que este mensaje no sabría explicar.
    expect(parentageChronologyIssue('ayer', CRIA)).toBeNull();
  });
});
