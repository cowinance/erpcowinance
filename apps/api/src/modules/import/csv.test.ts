import { describe, it, expect } from 'vitest';
import { detectarSeparador, parseCsv, CsvParseError, CsvIrregularRowError } from './csv';

/**
 * Pruebas del parser CSV del importador (P2 oleada 3, commit 3.1). Pura, sin DB.
 */

describe('parseCsv · casos básicos', () => {
  it('parsea encabezados + filas', () => {
    const r = parseCsv('caravana,sexo\n1234,F\n5678,M');
    expect(r.headers).toEqual(['caravana', 'sexo']);
    expect(r.rows).toEqual([
      { caravana: '1234', sexo: 'F' },
      { caravana: '5678', sexo: 'M' },
    ]);
  });

  it('recorta espacios de los ENCABEZADOS (no de los valores)', () => {
    const r = parseCsv('  caravana ,  sexo\n  12  ,F');
    expect(r.headers).toEqual(['caravana', 'sexo']);
    expect(r.rows[0].caravana).toBe('  12  '); // valor preservado; normaliza Herd
  });

  it('salta líneas vacías', () => {
    const r = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(r.rows).toHaveLength(2);
  });
});

describe('parseCsv · campos entrecomillados', () => {
  it('coma embebida en campo entrecomillado', () => {
    const r = parseCsv('a,b\n1,"x,y"');
    expect(r.rows[0].b).toBe('x,y');
  });

  it('salto de línea embebido en campo entrecomillado', () => {
    const r = parseCsv('a,b\n1,"li\nne"');
    expect(r.rows[0].b).toBe('li\nne');
  });

  it('descarta el BOM UTF-8', () => {
    const r = parseCsv('﻿caravana,sexo\n1,F');
    expect(r.headers[0]).toBe('caravana');
  });
});

describe('parseCsv · filas irregulares', () => {
  it('fila con MENOS columnas → se conserva con los faltantes ausentes', () => {
    const r = parseCsv('a,b,c\n1,2');
    expect(r.rows[0].a).toBe('1');
    expect(r.rows[0].b).toBe('2');
    expect(r.rows[0].c).toBeUndefined();
  });

  it('fila con MÁS columnas → CsvIrregularRowError (no trunca en silencio)', () => {
    expect(() => parseCsv('a,b\n1,2,3')).toThrow(CsvIrregularRowError);
  });

  it('CsvIrregularRowError lleva el número de fila (de datos, 1-based) y el código de dominio', () => {
    try {
      parseCsv('a,b\n1,2\n3,4,5'); // la 2.ª fila de datos tiene una columna de más
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect((e as CsvIrregularRowError).code).toBe('import.irregular_row');
      expect((e as CsvIrregularRowError).rowNumber).toBe(2);
    }
  });
});

describe('parseCsv · contenido inválido', () => {
  it('entrada vacía → CsvParseError', () => {
    expect(() => parseCsv('')).toThrow(CsvParseError);
  });

  it('solo espacios/BOM sin encabezados → CsvParseError', () => {
    expect(() => parseCsv('﻿')).toThrow(CsvParseError);
  });

  it('el error lleva código de dominio import.csv_parse_error', () => {
    try {
      parseCsv('');
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect((e as CsvParseError).code).toBe('import.csv_parse_error');
    }
  });
});

describe('el separador sale del archivo, no de una suposición', () => {
  it('EXCEL EN ESPAÑOL GUARDA CON PUNTO Y COMA', () => {
    // Es lo que sale de «Guardar como → CSV» en cualquier máquina configurada en español, porque la
    // coma es el separador decimal. Con el separador fijo en coma ese archivo se leía como UNA sola
    // columna —el encabezado entero en una celda— y la importación moría ahí, con un mensaje que
    // culpaba al mapeo.
    const csv = 'Caravana;Sexo;Categoría\nA-1;H;Vaca';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(['Caravana', 'Sexo', 'Categoría']);
    expect(r.rows[0]).toEqual({ Caravana: 'A-1', Sexo: 'H', 'Categoría': 'Vaca' });
  });

  it('la coma sigue andando, que es el caso de siempre', () => {
    const r = parseCsv('caravana,sexo\nA-1,H');
    expect(r.headers).toEqual(['caravana', 'sexo']);
    expect(r.rows[0]).toEqual({ caravana: 'A-1', sexo: 'H' });
  });

  it('también tabulaciones y barras verticales', () => {
    expect(parseCsv('caravana\tsexo\nA-1\tH').headers).toEqual(['caravana', 'sexo']);
    expect(parseCsv('caravana|sexo\nA-1|H').headers).toEqual(['caravana', 'sexo']);
  });

  it('NO CUENTA LOS SEPARADORES QUE ESTÁN ENTRE COMILLAS', () => {
    // Un encabezado como «"Apellido, Nombre";Sexo» tiene una coma que no separa nada. Contarla
    // elegiría la coma y partiría el archivo por el lugar equivocado.
    // El caso tiene que DISCRIMINAR: si las comas de adentro pesaran, ganarían por cantidad y el
    // archivo se partiría por el lugar equivocado. Cuatro comas encerradas contra un punto y coma
    // que sí separa.
    expect(detectarSeparador('"a,b,c,d,e";Sexo')).toBe(';');
    expect(detectarSeparador('"Apellido, Nombre";Sexo;Edad')).toBe(';');
    expect(detectarSeparador('"a;b;c;d;e",Sexo')).toBe(',');
  });

  it('una sola columna no rompe: se queda con la coma', () => {
    expect(detectarSeparador('caravana')).toBe(',');
    expect(parseCsv('caravana\nA-1').headers).toEqual(['caravana']);
  });

  it('el BOM no se cuenta como parte del primer encabezado', () => {
    const r = parseCsv('\uFEFFCaravana;Sexo\nA-1;H');
    expect(r.headers).toEqual(['Caravana', 'Sexo']);
  });
});
