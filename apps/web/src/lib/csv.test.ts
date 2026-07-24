import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv — serialización robusta', () => {
  it('neutraliza la inyección de fórmulas en TEXTO', () => {
    // Sin el apóstrofo, Excel/Sheets ejecutarían esto al abrir el archivo.
    expect(toCsv([['=1+1']])).toBe("'=1+1");
    expect(toCsv([['@SUM(A1:A9)']])).toBe("'@SUM(A1:A9)");
    expect(toCsv([['-1+1']])).toBe("'-1+1");
    expect(toCsv([['+34 11 5555']])).toBe("'+34 11 5555");
  });

  it('un NÚMERO negativo NO se escapa: debe seguir siendo sumable en la planilla', () => {
    // El apóstrofo lo convertiría en texto y rompería toda columna de margen/desvío.
    expect(toCsv([[-7331.57]])).toBe('-7331.57');
    expect(toCsv([[-100]])).toBe('-100');
    expect(toCsv([[0]])).toBe('0');
  });

  it('entrecomilla lo que lleva comas, comillas o saltos de línea', () => {
    expect(toCsv([['Rodeo, Cría']])).toBe('"Rodeo, Cría"');
    expect(toCsv([['Dijo "hola"']])).toBe('"Dijo ""hola"""');
    expect(toCsv([['dos\nlíneas']])).toBe('"dos\nlíneas"');
  });

  it('null y valores no finitos quedan como celda vacía en vez de "null" o "NaN"', () => {
    expect(toCsv([[null, Number.NaN, Number.POSITIVE_INFINITY]])).toBe(',,');
  });

  it('arma filas y columnas', () => {
    expect(toCsv([['Concepto', 'Margen'], ['Engorde', -7331.57]])).toBe('Concepto,Margen\nEngorde,-7331.57');
  });
});
