import { describe, expect, it } from 'vitest';
import {
  InvalidCryoLocationError,
  cryoLocationLabel,
  isKnownCryoColor,
  normalizeCryoColor,
  validateCanister,
  validateGoblet,
  validateTank,
} from './cryo-storage';

describe('validateTank', () => {
  // El código es lo que la finca dice en voz alta («el 207»). El nombre es opcional a propósito:
  // exigirlo obligaría a inventar uno para poder cargar el termo.
  it('exige el código y deja el nombre opcional', () => {
    expect(validateTank({ code: ' 207 ' })).toEqual({
      code: '207',
      name: null,
      canister_capacity: null,
      serial_number: null,
      notes: null,
    });
    expect(() => validateTank({ name: 'Termo de la sala' })).toThrow(InvalidCryoLocationError);
    expect(() => validateTank({ code: '   ' })).toThrow(InvalidCryoLocationError);
  });

  it('rechaza una capacidad que no sea un entero positivo', () => {
    expect(validateTank({ code: '3', canister_capacity: 6 }).canister_capacity).toBe(6);
    // Vacío o ausente = «no sé cuántas entran», que es distinto de cero.
    expect(validateTank({ code: '3', canister_capacity: '' }).canister_capacity).toBeNull();
    for (const malo of [0, -1, 2.5, 'seis']) expect(() => validateTank({ code: '3', canister_capacity: malo })).toThrow(InvalidCryoLocationError);
  });
});

describe('validateCanister / validateGoblet', () => {
  it('normaliza el color y conserva el número', () => {
    expect(validateCanister({ code: ' 2 ', color: '  AZUL ' })).toMatchObject({ code: '2', color: 'azul' });
    expect(validateGoblet({ code: '5', color: 'Rojo' })).toMatchObject({ code: '5', color: 'rojo' });
  });

  it('el color es opcional', () => {
    expect(validateCanister({ code: '1' }).color).toBeNull();
    expect(validateCanister({ code: '1', color: '   ' }).color).toBeNull();
  });

  // La finca usa los colores que le vendieron, no los que listemos nosotros: uno desconocido se
  // acepta igual, solo que la UI no lo pinta.
  it('acepta un color fuera de la paleta conocida', () => {
    expect(validateCanister({ code: '1', color: 'turquesa' }).color).toBe('turquesa');
    expect(isKnownCryoColor('turquesa')).toBe(false);
    expect(isKnownCryoColor('azul')).toBe(true);
    expect(isKnownCryoColor(null)).toBe(false);
  });

  it('rechaza un color absurdamente largo', () => {
    expect(() => normalizeCryoColor('x'.repeat(33))).toThrow(InvalidCryoLocationError);
  });
});

describe('cryoLocationLabel', () => {
  // Este texto va a aparecer en la lista de retiro, en la ficha de la pajuela y en el móvil. Que
  // salga de un solo lugar es lo que evita que dos pantallas nombren distinto la misma posición.
  it('arma la etiqueta hablada, con el color adelante del número', () => {
    expect(cryoLocationLabel({ tank_code: '207', canister_code: '2', canister_color: 'azul', goblet_code: '5' })).toBe(
      '207 · azul 2 · gob. 5',
    );
  });

  it('sin color, nombra la canasta igual', () => {
    expect(cryoLocationLabel({ tank_code: '003', canister_code: '1', goblet_code: '4' })).toBe('003 · can. 1 · gob. 4');
  });

  // Una pajuela recién migrada todavía no tiene posición: la etiqueta tiene que degradar, no romper.
  it('degrada cuando falta parte de la ubicación', () => {
    expect(cryoLocationLabel({ tank_code: '207' })).toBe('207');
    expect(cryoLocationLabel({})).toBe('');
  });
});
