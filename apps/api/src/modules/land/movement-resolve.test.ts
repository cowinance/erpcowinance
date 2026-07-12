import { describe, expect, it } from 'vitest';
import { resolveDestination } from './movement.service';

/**
 * Matriz de transiciones de `resolveDestination` (P3 M-1.a) — regla PURA del
 * invariante lote–potrero. `P` mapea lote→potrero: X en potrero A, Y sin potrero.
 */
const A = 'paddock-A';
const B = 'paddock-B';
const X = 'lot-X'; // en potrero A
const Y = 'lot-Y'; // sin potrero
const P = (lot: string): string | null => (lot === X ? A : lot === Y ? null : null);

const ok = (lot: string | null, paddock: string | null) => ({ ok: true, lot, paddock });

describe('resolveDestination · matriz lote–potrero', () => {
  it('ausente/ausente → movement.noop', () => {
    expect(resolveDestination({ lot: X, paddock: A }, {}, P)).toMatchObject({ ok: false, code: 'movement.noop' });
  });

  it('solo lote Y (con potrero) → deriva el potrero del lote', () => {
    expect(resolveDestination({ lot: null, paddock: null }, { lot: X }, P)).toEqual(ok(X, A));
  });

  it('solo lote sin potrero → potrero null', () => {
    expect(resolveDestination({ lot: null, paddock: B }, { lot: Y }, P)).toEqual(ok(Y, null));
  });

  it('lote + potrero coherentes → aceptado', () => {
    expect(resolveDestination({ lot: null, paddock: null }, { lot: X, paddock: A }, P)).toEqual(ok(X, A));
  });

  it('lote + potrero incoherentes → mismatch', () => {
    expect(resolveDestination({ lot: null, paddock: null }, { lot: X, paddock: B }, P)).toMatchObject({
      ok: false,
      code: 'movement.lot_paddock_mismatch',
    });
  });

  it('lote con potrero + paddock=null explícito → mismatch (no puede quedar sin potrero)', () => {
    expect(resolveDestination({ lot: null, paddock: null }, { lot: X, paddock: null }, P)).toMatchObject({
      ok: false,
      code: 'movement.lot_paddock_mismatch',
    });
  });

  it('lote sin potrero + paddock=null → aceptado (coherente)', () => {
    expect(resolveDestination({ lot: null, paddock: null }, { lot: Y, paddock: null }, P)).toEqual(ok(Y, null));
  });

  it('limpiar lote (null), potrero ausente → conserva potrero, queda sin lote', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { lot: null }, P)).toEqual(ok(null, A));
  });

  it('null lote + potrero B → sin lote, potrero B', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { lot: null, paddock: B }, P)).toEqual(ok(null, B));
  });

  it('limpieza total (lote null, potrero null)', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { lot: null, paddock: null }, P)).toEqual(ok(null, null));
  });

  it('solo potrero, animal SIN lote → mueve el potrero', () => {
    expect(resolveDestination({ lot: null, paddock: A }, { paddock: B }, P)).toEqual(ok(null, B));
  });

  it('solo potrero, animal EN lote hacia el mismo potrero del lote → aceptado (coherente)', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { paddock: A }, P)).toEqual(ok(X, A));
  });

  it('solo potrero, animal EN lote hacia OTRO potrero → mismatch (no arrastra el lote)', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { paddock: B }, P)).toMatchObject({
      ok: false,
      code: 'movement.lot_paddock_mismatch',
    });
  });

  it('solo potrero=null, animal EN lote ubicado → mismatch (no deja lote sin potrero)', () => {
    expect(resolveDestination({ lot: X, paddock: A }, { paddock: null }, P)).toMatchObject({
      ok: false,
      code: 'movement.lot_paddock_mismatch',
    });
  });
});
