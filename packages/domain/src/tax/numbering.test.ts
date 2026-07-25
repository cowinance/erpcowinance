import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PADDING,
  FISCAL_DOCUMENT_TYPES,
  FISCAL_DOCUMENT_TYPE_LABEL,
  InvalidSeriesError,
  formatFiscalNumber,
  seriesStatus,
  validateSeries,
} from './numbering';

describe('formato del número fiscal', () => {
  it('rellena con ceros al ancho del comprobante', () => {
    // `00-00000123` y `00-123` serían el mismo número escrito de dos formas, que es lo que rompe un
    // correlativo cuando alguien lo busca.
    expect(formatFiscalNumber('00', 123)).toBe('00-00000123');
    expect(formatFiscalNumber('00', 1)).toBe('00-00000001');
  });

  it('sin prefijo devuelve solo el cuerpo, sin guion suelto', () => {
    expect(formatFiscalNumber(null, 45)).toBe('00000045');
    expect(formatFiscalNumber('', 45)).toBe('00000045');
    expect(formatFiscalNumber('   ', 45)).toBe('00000045');
  });

  it('respeta un ancho distinto', () => {
    expect(formatFiscalNumber('A', 7, 4)).toBe('A-0007');
  });

  it('un número más largo que el ancho no se trunca', () => {
    // Perder dígitos daría dos comprobantes con el mismo número impreso.
    expect(formatFiscalNumber('00', 123456789)).toBe('00-123456789');
  });

  it('el ancho por defecto es el que se usa en la forma libre', () => {
    expect(formatFiscalNumber('00', 1)).toBe(`00-${'1'.padStart(DEFAULT_PADDING, '0')}`);
  });
});

describe('agotamiento del lote', () => {
  it('cuenta lo que queda incluyendo el número que está por salir', () => {
    // Con próximo=1 y tope=100 quedan 100, no 99: el 1 todavía no se usó.
    expect(seriesStatus(1, 100).remaining).toBe(100);
    expect(seriesStatus(100, 100).remaining).toBe(1);
  });

  it('avisa ANTES de quedarse sin formas, no cuando ya no se puede facturar', () => {
    expect(seriesStatus(1, 5000).health).toBe('ok');
    expect(seriesStatus(4960, 5000).health).toBe('low'); // quedan 41
    expect(seriesStatus(5001, 5000).health).toBe('exhausted');
  });

  it('agotada no propone número siguiente', () => {
    const s = seriesStatus(5001, 5000, '00');
    expect(s.remaining).toBe(0);
    expect(s.nextFormatted).toBeNull();
  });

  it('sin tope el remanente es null, que NO es cero', () => {
    // Es el correlativo propio del emisor: no se agota, no hay nada que avisar. Confundir null con
    // 0 mostraría «serie agotada» en una serie que nunca lo está.
    const s = seriesStatus(1234, null, '');
    expect(s.remaining).toBeNull();
    expect(s.health).toBe('ok');
    expect(s.nextFormatted).toBe('00001234');
  });

  it('el umbral de aviso es configurable', () => {
    expect(seriesStatus(4900, 5000, '00', 8, 200).health).toBe('low');
    expect(seriesStatus(4900, 5000, '00', 8, 10).health).toBe('ok');
  });
});

describe('validación de la serie', () => {
  const problema = (input: Parameters<typeof validateSeries>[0]) => {
    try {
      validateSeries(input);
      return 'ok';
    } catch (e) {
      return (e as InvalidSeriesError).problem;
    }
  };

  it('acepta una serie bien definida', () => {
    expect(problema({ prefix: '00', padding: 8, rangeFrom: 1, rangeTo: 5000, next: 1 })).toBe('ok');
    expect(problema({ prefix: null, next: 1 })).toBe('ok');
  });

  it('el prefijo va impreso: sin guiones ni espacios', () => {
    // Un guion adentro daría `00-01-00000123`.
    expect(problema({ prefix: '00-01', next: 1 })).toBe('bad_prefix');
    expect(problema({ prefix: 'A B', next: 1 })).toBe('bad_prefix');
    expect(problema({ prefix: 'DEMASIADO', next: 1 })).toBe('bad_prefix');
  });

  it('rechaza un ancho imposible', () => {
    expect(problema({ padding: 0, next: 1 })).toBe('bad_padding');
    expect(problema({ padding: 99, next: 1 })).toBe('bad_padding');
    expect(problema({ padding: 2.5, next: 1 })).toBe('bad_padding');
  });

  it('rechaza un lote al revés', () => {
    expect(problema({ rangeFrom: 500, rangeTo: 100, next: 500 })).toBe('bad_range');
  });

  it('rechaza arrancar FUERA del lote autorizado', () => {
    // Es el error caro: emitir con un número de control que la imprenta nunca imprimió.
    expect(problema({ rangeFrom: 100, rangeTo: 5000, next: 99 })).toBe('bad_start');
    expect(problema({ rangeFrom: 1, rangeTo: 5000, next: 5002 })).toBe('bad_start');
  });

  it('arrancar justo en el tope+1 se acepta: es la serie recién agotada', () => {
    // No es un error de definición, es el estado normal de un lote que se terminó.
    expect(problema({ rangeFrom: 1, rangeTo: 5000, next: 5001 })).toBe('ok');
  });

  it('rechaza un próximo número que no es un entero positivo', () => {
    expect(problema({ next: 0 })).toBe('bad_start');
    expect(problema({ next: -1 })).toBe('bad_start');
    expect(problema({ next: 1.5 })).toBe('bad_start');
  });
});

describe('tipos de comprobante', () => {
  it('todos tienen etiqueta', () => {
    for (const t of FISCAL_DOCUMENT_TYPES) expect(FISCAL_DOCUMENT_TYPE_LABEL[t]).toBeTruthy();
  });
});
