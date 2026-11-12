import { describe, expect, it } from 'vitest';
import { primitive, semantic, type SemanticTheme } from './tokens';
import { AA_TEXTO, AA_TEXTO_GRANDE, aRgb, contraste, contrasteRedondeado, luminancia } from './contraste';

/**
 * El contraste de la paleta, medido.
 *
 * Esto no está acá para cumplir una norma: está porque la app se usa **con el teléfono al sol**,
 * en un corral, y un gris claro sobre blanco ahí no existe. WCAG da el número con el que se puede
 * discutir eso sin opinar.
 *
 * La división sigue el criterio del resto del repositorio: lo que HOY cumple queda como invariante
 * que no puede empeorar, y lo que NO cumple queda con su número exacto escrito y la razón por la
 * que se tolera. Un umbral bajado para que el test pase sería peor que no tener test.
 */
describe('contraste de la paleta', () => {
  const temas: [string, SemanticTheme][] = [
    ['claro', semantic.light],
    ['oscuro', semantic.dark],
  ];

  /** `accent` puede ser una referencia a un primitivo; acá hace falta el color resuelto. */
  const resolver = (v: SemanticTheme['accent']): string =>
    typeof v === 'string' ? v : (primitive.brand[v.$ref.replace('brand-', '') as keyof typeof primitive.brand] as string);

  describe('la matemática', () => {
    it('negro sobre blanco es el máximo, y un color consigo mismo es el mínimo', () => {
      expect(contrasteRedondeado('#000000', '#ffffff')).toBe(21);
      expect(contrasteRedondeado('#3a7d5b', '#3a7d5b')).toBe(1);
    });

    it('es simétrica: no importa cuál es el fondo', () => {
      expect(contraste('#191c1a', '#ffffff')).toBeCloseTo(contraste('#ffffff', '#191c1a'), 10);
    });

    it('entiende el hexadecimal corto y rechaza lo que no es un color', () => {
      expect(aRgb('#fff')).toEqual([255, 255, 255]);
      expect(aRgb('#1f4e3d')).toEqual([31, 78, 61]);
      expect(() => aRgb('verde')).toThrow(/hexadecimal/);
      expect(() => aRgb('#12345')).toThrow(/hexadecimal/);
    });

    it('la luminancia va de 0 a 1', () => {
      expect(luminancia('#000000')).toBe(0);
      expect(luminancia('#ffffff')).toBeCloseTo(1, 10);
    });
  });

  /**
   * INVARIANTE. Todo lo de acá cumple AA hoy; el test existe para que siga cumpliéndolo. Un cambio
   * de paleta que baje cualquiera de estos números falla antes de llegar a un teléfono.
   */
  describe('lo que no puede empeorar', () => {
    for (const [nombre, t] of temas) {
      for (const fondo of Object.keys(t.bg) as (keyof SemanticTheme['bg'])[]) {
        it(`${nombre}: el texto principal y el secundario cumplen AA sobre ${fondo}`, () => {
          expect(contraste(t.text.primary, t.bg[fondo])).toBeGreaterThanOrEqual(AA_TEXTO);
          expect(contraste(t.text.secondary, t.bg[fondo])).toBeGreaterThanOrEqual(AA_TEXTO);
        });
      }

      it(`${nombre}: los colores de estado cumplen AA sobre la superficie`, () => {
        for (const [estado, color] of Object.entries(t.status)) {
          expect(contraste(color, t.bg.surface), `status.${estado}`).toBeGreaterThanOrEqual(AA_TEXTO);
        }
      });

      /** El botón primario: texto blanco sobre el color de marca. Es el control más usado. */
      it(`${nombre}: el blanco sobre el acento cumple AA`, () => {
        expect(contraste('#ffffff', resolver(t.accent))).toBeGreaterThanOrEqual(AA_TEXTO);
      });
    }

    /** La marca sobre fondo claro: la usa el móvil como color de texto de los botones de contorno. */
    it('claro: el acento cumple AA como color de texto sobre la superficie', () => {
      expect(contraste(resolver(semantic.light.accent), semantic.light.bg.surface)).toBeGreaterThanOrEqual(AA_TEXTO);
    });
  });

  /**
   * LO QUE NO CUMPLE, con su número.
   *
   * No se baja el umbral ni se tapa: se escribe cuánto da y bajo qué condición se tolera. Si
   * alguien mejora la paleta, estos tests fallan por arriba y hay que subir el piso — que es la
   * forma correcta de enterarse.
   */
  describe('deuda de contraste conocida', () => {
    /**
     * `text.tertiary` está por DEBAJO de AA en los dos temas (2,86 a 3,85). Se usa para notas al
     * pie, marcas de tiempo y ayudas — nunca para algo que haya que leer para decidir. Bajo el sol
     * directo es, en la práctica, invisible: **no debería llevar información que no esté también
     * en otro lado**. Subirlo a AA es una decisión de diseño con alcance en web y móvil.
     */
    it('el texto terciario no llega a AA en ningún tema', () => {
      for (const [, t] of temas) {
        for (const fondo of Object.values(t.bg)) {
          expect(contraste(t.text.tertiary, fondo)).toBeLessThan(AA_TEXTO);
        }
      }
    });

    it('el texto terciario tampoco llega al piso de texto grande sobre el fondo hundido claro', () => {
      // 2,86 — el peor caso de toda la paleta.
      expect(contrasteRedondeado(semantic.light.text.tertiary, semantic.light.bg.sunken)).toBe(2.86);
      expect(contraste(semantic.light.text.tertiary, semantic.light.bg.sunken)).toBeLessThan(AA_TEXTO_GRANDE);
    });

    /**
     * `border.strong` da 1,5 contra la superficie, muy por debajo del 3 que WCAG 2.1 pide para un
     * borde que sea el ÚNICO indicio de un control. Hoy se usa así en al menos un botón de
     * contorno del móvil. Sirve de separador; no debería ser lo único que define un control.
     */
    it('el borde fuerte no alcanza el piso de elementos no textuales', () => {
      expect(contrasteRedondeado(semantic.light.border.strong, semantic.light.bg.surface)).toBe(1.54);
      expect(contrasteRedondeado(semantic.dark.border.strong, semantic.dark.bg.surface)).toBe(1.53);
    });

    /** En oscuro el acento da 3,55: sirve para un título grande, no para texto corrido. */
    it('oscuro: el acento solo alcanza para texto grande', () => {
      const r = contraste(resolver(semantic.dark.accent), semantic.dark.bg.surface);
      expect(r).toBeGreaterThanOrEqual(AA_TEXTO_GRANDE);
      expect(r).toBeLessThan(AA_TEXTO);
    });
  });
});
