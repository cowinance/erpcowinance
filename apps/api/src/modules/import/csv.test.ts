import { describe, it, expect } from 'vitest';
import { parseCsv, CsvParseError } from './csv';

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

describe('parseCsv · filas irregulares (tolerantes)', () => {
  it('fila con menos columnas → faltantes ausentes, no aborta', () => {
    const r = parseCsv('a,b,c\n1,2');
    expect(r.rows[0].a).toBe('1');
    expect(r.rows[0].b).toBe('2');
    expect(r.rows[0].c).toBeUndefined();
  });

  it('fila con más columnas → no aborta', () => {
    expect(() => parseCsv('a,b\n1,2,3')).not.toThrow();
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
