import { describe, it, expect } from 'vitest';
import { MAX_CRASHES, MAX_STACK_CHARS, appendCrash, formatCrashes, redactar, toCrashRecord } from './crash-log';

const AHORA = new Date('2026-05-01T12:00:00Z');

describe('toCrashRecord', () => {
  it('guarda mensaje, pila e instante de un Error', () => {
    const e = new Error('no se pudo leer el animal');
    const r = toCrashRecord(e, '\n    en Manga\n    en Gate', AHORA);
    expect(r.message).toBe('no se pudo leer el animal');
    expect(r.at).toBe('2026-05-01T12:00:00.000Z');
    expect(r.stack).toContain('no se pudo leer el animal');
    expect(r.component).toContain('en Manga');
  });

  /** React puede tirar cualquier cosa, no solo Error. El registro no puede quedar vacío por eso. */
  it('soporta que lo lanzado no sea un Error', () => {
    expect(toCrashRecord('se rompió', undefined, AHORA).message).toBe('se rompió');
    expect(toCrashRecord({ raro: true }, undefined, AHORA).message).toBe('Error desconocido en el render');
    expect(toCrashRecord(undefined, undefined, AHORA).message).toBe('Error desconocido en el render');
  });

  it('un mensaje vacío igual deja algo legible', () => {
    expect(toCrashRecord(new Error(''), undefined, AHORA).message).toBe('Error desconocido en el render');
  });

  it('recorta pilas enormes en vez de llenar el teléfono', () => {
    const e = new Error('x');
    e.stack = 'a'.repeat(MAX_STACK_CHARS * 3);
    const r = toCrashRecord(e, undefined, AHORA);
    expect(r.stack!.length).toBeLessThan(MAX_STACK_CHARS + 50);
    expect(r.stack).toContain('recortado');
  });

  it('no deja sin pila a un error que no la trae', () => {
    const e = new Error('x');
    e.stack = undefined;
    expect(toCrashRecord(e, undefined, AHORA).stack).toBeUndefined();
  });
});

/**
 * Esto persiste texto arbitrario en el dispositivo y después se comparte para diagnosticar.
 * El momento de no escribir una credencial es antes de guardarla.
 */
describe('redactar', () => {
  it('tapa un JWT', () => {
    const t = redactar('falló con eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123 al pedir');
    expect(t).not.toContain('eyJhbGci');
    expect(t).toContain('«token»');
  });

  it('tapa lo que venga rotulado como credencial', () => {
    expect(redactar('Authorization: Bearer abc123xyz')).toContain('«oculto»');
    expect(redactar('refresh_token=r-9f8a7')).not.toContain('r-9f8a7');
    expect(redactar('password: hunter2')).not.toContain('hunter2');
  });

  it('deja intacto un mensaje normal', () => {
    expect(redactar('pull → 500')).toBe('pull → 500');
  });

  it('se aplica también a la pila guardada', () => {
    const e = new Error('Bearer abc123xyz');
    e.stack = 'Error: Bearer abc123xyz\n    en fetch';
    const r = toCrashRecord(e, undefined, AHORA);
    expect(r.message).not.toContain('abc123xyz');
    expect(r.stack).not.toContain('abc123xyz');
  });
});

describe('appendCrash', () => {
  const crash = (msg: string) => toCrashRecord(new Error(msg), undefined, AHORA);

  it('pone el más reciente primero', () => {
    const lista = appendCrash(appendCrash([], crash('viejo')), crash('nuevo'));
    expect(lista.map((c) => c.message)).toEqual(['nuevo', 'viejo']);
  });

  it('no guarda más de MAX_CRASHES', () => {
    let lista = appendCrash(undefined, crash('0'));
    for (let i = 1; i < MAX_CRASHES + 5; i++) lista = appendCrash(lista, crash(String(i)));
    expect(lista).toHaveLength(MAX_CRASHES);
    expect(lista[0].message).toBe(String(MAX_CRASHES + 4));
  });

  it('no muta la lista que recibe', () => {
    const previa = [crash('a')];
    appendCrash(previa, crash('b'));
    expect(previa).toHaveLength(1);
  });

  it('arranca bien desde nada guardado', () => {
    expect(appendCrash(undefined, crash('primero'))).toHaveLength(1);
  });
});

describe('formatCrashes', () => {
  it('dice que no hay nada en vez de devolver vacío', () => {
    expect(formatCrashes([])).toBe('Sin fallos registrados.');
  });

  it('numera los fallos y separa uno de otro', () => {
    const texto = formatCrashes([
      toCrashRecord(new Error('uno'), undefined, AHORA),
      toCrashRecord(new Error('dos'), undefined, AHORA),
    ]);
    expect(texto).toContain('#1 · 2026-05-01T12:00:00.000Z');
    expect(texto).toContain('#2 ·');
    expect(texto).toContain('uno');
    expect(texto).toContain('dos');
  });
});
