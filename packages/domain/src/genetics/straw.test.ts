import { describe, expect, it } from 'vitest';
import {
  InvalidStrawTransitionError,
  assertStrawTransition,
  isStrawAvailable,
  summarizeStraws,
  validateStrawBatch,
} from './straw';

describe('assertStrawTransition', () => {
  it('de guardada se sale hacia cualquier destino', () => {
    for (const destino of ['used', 'lost', 'discarded', 'sold'] as const)
      expect(() => assertStrawTransition('stored', destino)).not.toThrow();
  });

  // Son errores de registro: la pajuela sigue físicamente en el termo.
  it('perdida, descartada y vendida vuelven al stock', () => {
    for (const origen of ['lost', 'discarded', 'sold'] as const)
      expect(() => assertStrawTransition(origen, 'stored')).not.toThrow();
  });

  /**
   * La regla que justifica que esto sea una máquina de estados y no un booleano: devolver al stock
   * una pajuela usada dejaría un evento reproductivo apuntando a una pajuela que el sistema cree
   * entera. El error está en el servicio, y ahí hay que corregirlo.
   */
  it('una pajuela usada NO vuelve al stock, y lo explica', () => {
    expect(() => assertStrawTransition('used', 'stored')).toThrow(InvalidStrawTransitionError);
    expect(() => assertStrawTransition('used', 'stored')).toThrow(/corregir ese servicio/);
  });

  it('no admite transiciones entre salidas ni hacia el mismo estado', () => {
    expect(() => assertStrawTransition('lost', 'sold')).toThrow(InvalidStrawTransitionError);
    expect(() => assertStrawTransition('stored', 'stored')).toThrow(/ya está en estado/);
  });

  it('solo cuenta como stock LIBRE lo guardado — reservada no', () => {
    expect(isStrawAvailable('stored')).toBe(true);
    for (const s of ['reserved', 'used', 'lost', 'discarded', 'sold'] as const) expect(isStrawAvailable(s)).toBe(false);
  });

  // Reservada es transitorio: o se sirve, o vuelve al stock. Perderla o venderla estando reservada
  // dejaría a la vaca que la tenía asignada sin nada, y en silencio.
  it('una reservada solo puede servirse o volver al stock', () => {
    expect(() => assertStrawTransition('stored', 'reserved')).not.toThrow();
    expect(() => assertStrawTransition('reserved', 'used')).not.toThrow();
    expect(() => assertStrawTransition('reserved', 'stored')).not.toThrow();
    expect(() => assertStrawTransition('reserved', 'sold')).toThrow(/Soltá primero esa asignación/);
    expect(() => assertStrawTransition('reserved', 'lost')).toThrow(InvalidStrawTransitionError);
  });
});

describe('validateStrawBatch', () => {
  it('acepta el alta en bloque de una compra', () => {
    expect(validateStrawBatch({ quantity: 20 })).toMatchObject({ quantity: 20, code: null, goblet_id: null });
  });

  it('rechaza cantidades que no son enteros positivos', () => {
    for (const malo of [0, -3, 2.5, 'veinte', undefined]) expect(() => validateStrawBatch({ quantity: malo })).toThrow(InvalidStrawTransitionError);
  });

  // Un dedo pegado en el teclado numérico generaría stock que después hay que borrar de a una.
  it('pone un tope al alta masiva', () => {
    expect(() => validateStrawBatch({ quantity: 5000 })).toThrow(/más de 500/);
  });

  // El código impreso identifica UNA pajuela; repetirlo en veinte las vuelve indistinguibles, que es
  // justo lo que el código venía a resolver.
  it('no deja poner un código impreso a un bloque', () => {
    expect(validateStrawBatch({ quantity: 1, code: ' ABC-1 ' }).code).toBe('ABC-1');
    expect(() => validateStrawBatch({ quantity: 20, code: 'ABC-1' })).toThrow(/una sola pajuela/);
  });
});

describe('summarizeStraws', () => {
  const filas = [
    { status: 'stored' as const, goblet_id: 'g1' },
    { status: 'stored' as const, goblet_id: 'g1' },
    { status: 'stored' as const, goblet_id: null },
    { status: 'reserved' as const, goblet_id: 'g1' },
    { status: 'used' as const, goblet_id: 'g1' },
    { status: 'lost' as const, goblet_id: 'g1' },
    { status: 'sold' as const, goblet_id: null },
  ];

  /**
   * `unlocated` va aparte a propósito: son las que existen pero nadie sabe dónde. Sumadas a las
   * disponibles darían un saldo que parece completo mientras media partida es, en la práctica,
   * imposible de encontrar dentro del termo.
   */
  it('separa lo disponible entre ubicado y sin ubicar, y lo reservado aparte', () => {
    // Reservada NO suma a `available`: sigue en el termo pero ya tiene dueña. Si sumara, se podrían
    // planificar 30 servicios sobre 20 pajuelas.
    expect(summarizeStraws(filas)).toEqual({ available: 3, located: 2, unlocated: 1, reserved: 1, used: 1, other_exits: 2 });
  });

  it('un conjunto vacío da todo en cero', () => {
    expect(summarizeStraws([])).toEqual({ available: 0, located: 0, unlocated: 0, reserved: 0, used: 0, other_exits: 0 });
  });
});
