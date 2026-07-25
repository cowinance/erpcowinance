import { describe, expect, it } from 'vitest';
import {
  InvalidRifError,
  RIF_PREFIXES,
  completeRif,
  isValidRif,
  normalizeRif,
  parseRif,
  rifCheckDigit,
  type RifPrefix,
} from './rif';

describe('RIF — dígito verificador', () => {
  /**
   * El ancla de todo el módulo: un RIF REAL y público, no uno construido con el mismo algoritmo que
   * se está probando. PDVSA Petróleo, S.A. es `J-00123072-6` (aparece en expedientes del contencioso
   * tributario). Si el algoritmo estuviera mal, este es el test que lo delata; los demás casos, al
   * derivarse del propio cálculo, se equivocarían en coro.
   */
  it('reproduce el dígito de un RIF real y publicado (PDVSA Petróleo, J-00123072-6)', () => {
    expect(rifCheckDigit('J', '00123072')).toBe(6);
    expect(isValidRif('J-00123072-6')).toBe(true);
  });

  it('rechaza ese mismo RIF con cualquier otro dígito', () => {
    for (let d = 0; d <= 9; d++) {
      if (d === 6) continue;
      expect(isValidRif(`J-00123072-${d}`)).toBe(false);
    }
  });

  it('la letra cambia el dígito: el mismo número con otro prefijo es otro RIF', () => {
    // Es lo que hace que el prefijo no sea decorativo. Si entrara con valor 0, V y J darían igual.
    const porLetra = RIF_PREFIXES.map((p) => rifCheckDigit(p, '00123072'));
    expect(new Set(porLetra).size).toBeGreaterThan(1);
  });

  it('el dígito nunca se va de rango, ni siquiera cuando el resto colapsa', () => {
    // 10 y 11 no son dígitos: los restos 1 y 0 caen los dos en 0.
    for (let n = 0; n < 3000; n++) {
      const body = String(n).padStart(8, '0');
      const dv = rifCheckDigit('J', body);
      expect(dv).toBeGreaterThanOrEqual(0);
      expect(dv).toBeLessThanOrEqual(9);
    }
  });
});

describe('RIF — normalización', () => {
  it('el mismo RIF escrito de cualquier forma es el mismo RIF', () => {
    // Guardar variantes de la misma identidad es lo que después duplica clientes.
    for (const variante of ['J-00123072-6', 'J001230726', 'j00123072 6', 'j.00123072.6', ' J-00123072-6 ']) {
      expect(normalizeRif(variante)).toBe('J001230726');
      expect(isValidRif(variante)).toBe(true);
    }
  });

  it('devuelve la forma canónica, que es como se imprime en el comprobante', () => {
    expect(parseRif('j00123072 6').formatted).toBe('J-00123072-6');
  });

  it('conserva los ceros a la izquierda', () => {
    // Tratar el cuerpo como número perdería los ceros y cambiaría el RIF.
    const r = parseRif('J-00123072-6');
    expect(r.body).toBe('00123072');
  });
});

describe('RIF — qué está mal, no solo que está mal', () => {
  const problema = (raw: string) => {
    try {
      parseRif(raw);
      return 'ok';
    } catch (e) {
      return (e as InvalidRifError).problem;
    }
  };

  it('distingue cada problema para poder decirlo en la UI', () => {
    expect(problema('')).toBe('empty');
    expect(problema('   ')).toBe('empty');
    expect(problema('X-00123072-6')).toBe('bad_prefix');
    expect(problema('J-0012307-6')).toBe('bad_length'); // 7 dígitos
    expect(problema('J-001230725-6')).toBe('bad_length'); // 9 dígitos
    expect(problema('J-00123072-4')).toBe('bad_check_digit');
    expect(problema('J-00123072-6')).toBe('ok');
  });

  it('un RIF con la forma correcta y el número equivocado NO pasa', () => {
    // Es exactamente el caso que un regex dejaría entrar, y el que invalida una factura.
    expect(/^[VEJPG]-\d{8}-\d$/.test('J-00123072-4')).toBe(true);
    expect(isValidRif('J-00123072-4')).toBe(false);
  });
});

describe('RIF — completar el dígito (carga asistida)', () => {
  it('propone el dígito que falta', () => {
    expect(completeRif('J-00123072')).toBe('J-00123072-6');
    expect(completeRif('j00123072')).toBe('J-00123072-6');
  });

  it('lo que completa siempre es válido', () => {
    for (const p of RIF_PREFIXES as readonly RifPrefix[])
      for (const body of ['00000000', '12345678', '30123456', '99999999'])
        expect(isValidRif(completeRif(`${p}${body}`))).toBe(true);
  });

  it('no completa lo que no tiene forma de RIF', () => {
    expect(() => completeRif('J-1234567')).toThrow(InvalidRifError); // 7 dígitos
    expect(() => completeRif('X-12345678')).toThrow(InvalidRifError);
  });
});
