import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_LABELS, STATUS_LABELS, ageFrom, formatAdg, formatDate, formatKg, relativeTime } from './format';

/**
 * Cómo se escriben los números y las fechas en pantalla.
 *
 * Parece cosmético y no lo es: la diferencia entre «—» y «0 kg» es la diferencia entre «no hay
 * dato» y «pesa cero», y quien mira la lista toma decisiones con eso. Lo que se prueba acá es
 * sobre todo que un valor ausente NUNCA se muestre como un número.
 */
describe('formatKg', () => {
  it('redondea y pone la unidad', () => {
    expect(formatKg(412.4)).toBe('412 kg');
    expect(formatKg(412.6)).toBe('413 kg');
  });

  /** Un animal sin pesar no pesa cero: no se sabe. */
  it('sin dato muestra un guion, no un cero', () => {
    expect(formatKg(null)).toBe('—');
    expect(formatKg(undefined)).toBe('—');
    expect(formatKg(0)).toBe('0 kg');
  });
});

describe('formatAdg', () => {
  it('muestra dos decimales, que es la precisión con la que se habla de ganancia diaria', () => {
    expect(formatAdg(0.85)).toBe('0.85 kg/día');
    expect(formatAdg(1)).toBe('1.00 kg/día');
  });

  /** Una ganancia negativa es una alerta: no se puede esconder ni redondear a cero. */
  it('una ganancia negativa se muestra tal cual', () => {
    expect(formatAdg(-0.3)).toBe('-0.30 kg/día');
  });

  it('sin dato, guion', () => {
    expect(formatAdg(null)).toBe('—');
    expect(formatAdg(undefined)).toBe('—');
  });
});

describe('ageFrom y relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('menos de un año se cuenta en meses de calendario', () => {
    expect(ageFrom('2026-02-20')).toBe('3 m');
    expect(ageFrom('2025-08-20')).toBe('9 m');
  });

  /** El mes no está cumplido hasta que llega el día. */
  it('un mes a medias todavía no cuenta', () => {
    expect(ageFrom('2026-02-21')).toBe('2 m');
    expect(ageFrom('2026-02-19')).toBe('3 m');
  });

  /**
   * Con el cálculo viejo —dividir por un mes promedio de 30,44 días— un animal de exactamente dos
   * años aparecía como «1 a 11 m» en la lista del hato.
   */
  it('dos años cumplidos se dicen dos años', () => {
    expect(ageFrom('2024-05-20')).toBe('2 años');
    expect(ageFrom('2024-02-20')).toBe('2 a 3 m');
  });

  /** Reloj mal puesto o fecha cargada al revés: no se muestra una edad negativa. */
  it('una fecha futura no produce una edad', () => {
    expect(ageFrom('2027-01-01')).toBe('—');
    expect(ageFrom('no-es-fecha')).toBe('—');
  });

  /** Sin fecha de nacimiento el sistema no calcula edad, que es lo honesto (ver el alta rápida). */
  it('sin fecha de nacimiento no inventa una edad', () => {
    expect(ageFrom(null)).toBe('—');
    expect(ageFrom(undefined)).toBe('—');
    expect(ageFrom('')).toBe('—');
  });

  it('hoy y ayer se dicen con palabras', () => {
    expect(relativeTime('2026-05-20T08:00:00Z')).toBe('hoy');
    expect(relativeTime('2026-05-19T08:00:00Z')).toBe('ayer');
  });

  it('después se cuenta en días, meses y años', () => {
    expect(relativeTime('2026-05-15T12:00:00Z')).toBe('hace 5 días');
    expect(relativeTime('2026-03-20T12:00:00Z')).toBe('hace 2 meses');
    expect(relativeTime('2025-04-20T12:00:00Z')).toBe('hace 1.1 años');
  });

  it('un solo mes va en singular', () => {
    expect(relativeTime('2026-04-10T12:00:00Z')).toBe('hace 1 mes');
  });
});

describe('formatDate', () => {
  it('sin fecha, guion', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('escribe la fecha en español', () => {
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/2026/);
  });
});

/**
 * Las etiquetas son el vocabulario visible del producto. Una clave sin traducir se filtra a la
 * pantalla como `pregnancy_diagnosed`, y quien la lee no sabe qué pasó.
 */
describe('etiquetas', () => {
  /**
   * El timeline hace `EVENT_LABELS[tipo] ?? tipo`: una clave sin traducir se filtra tal cual a la
   * pantalla. Faltaban cinco de las que el móvil emite —celo, servicio, parto, diagnóstico
   * negativo y alta rápida—, así que quien capturaba un celo en el corral veía «heat» en la web.
   */
  it('cubren TODOS los eventos que el móvil emite', () => {
    const delMovil = ['birth', 'calving', 'heat', 'note', 'pregnancy_diagnosed', 'pregnancy_negative', 'registered', 'service', 'treatment', 'vaccination', 'weighing'];
    for (const tipo of delMovil) expect(EVENT_LABELS[tipo], tipo).toBeTruthy();
  });

  it('ninguna etiqueta quedó vacía o igual a su clave', () => {
    for (const [clave, texto] of Object.entries({ ...EVENT_LABELS, ...STATUS_LABELS })) {
      expect(texto.trim(), clave).not.toBe('');
      expect(texto, clave).not.toBe(clave);
    }
  });
});
