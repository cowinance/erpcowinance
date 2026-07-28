import { describe, expect, it } from 'vitest';
import {
  INBREEDING_BLOCK_THRESHOLD,
  animalInbreeding,
  describeInbreeding,
  inbreedingLevel,
  matingInbreeding,
  type Pedigree,
  type PedigreeNode,
} from './inbreeding';

/**
 * Un rodeo de prueba con los parentescos que aparecen de verdad en una finca.
 *
 *   TORO ── B ──┬── HIJO ──┬── NIETA        (TORO es abuelo de NIETA)
 *               └── HIJA   └── PRIMO…
 *
 * Los fundadores no tienen padres: es lo normal cuando el productor arranca a cargar y el pedigrí
 * se corta hacia atrás.
 */
const ped = (filas: Record<string, [string | null, string | null]>): Pedigree => {
  const m = new Map<string, PedigreeNode>();
  for (const [id, [sireId, damId]] of Object.entries(filas)) m.set(id, { sireId, damId });
  return m;
};

const RODEO = ped({
  TORO: [null, null],
  VACA: [null, null],
  VACA2: [null, null],
  AJENO: [null, null],
  AJENA: [null, null],
  AJENA2: [null, null],
  HIJO: ['TORO', 'VACA'], // hijo del toro
  HIJA: ['TORO', 'VACA'], // hermana entera de HIJO
  MEDIA: ['TORO', 'VACA2'], // media hermana (mismo padre, otra madre)
  NIETA: ['HIJO', 'AJENA'], // nieta del TORO
  PRIMO: ['HIJO', 'AJENA'], // hermano entero de NIETA
  PRIMA: ['HIJA', 'AJENA2'], // prima hermana de NIETA
});

describe('coeficiente de consanguinidad de un apareamiento', () => {
  it('ABUELO × NIETA DA 12,5% — el caso que el aviso viejo NO veía', () => {
    // El motivo de todo esto. El chequeo anterior miraba una sola generación, así que un toro que
    // se queda tres años en el rodeo pasaba limpio cuando entraban a servicio las hijas de sus
    // hijas. Es cuando la consanguinidad empieza a costar, y era invisible.
    expect(matingInbreeding('TORO', 'NIETA', RODEO)).toBe(0.125);
    expect(inbreedingLevel(matingInbreeding('TORO', 'NIETA', RODEO))).toBe('high');
  });

  it('padre × hija da 25%', () => {
    expect(matingInbreeding('TORO', 'HIJA', RODEO)).toBe(0.25);
  });

  it('hermanos enteros dan 25%', () => {
    expect(matingInbreeding('HIJO', 'HIJA', RODEO)).toBe(0.25);
  });

  it('medios hermanos dan 12,5%', () => {
    expect(matingInbreeding('HIJO', 'MEDIA', RODEO)).toBe(0.125);
  });

  it('primos hermanos dan 6,25%', () => {
    // El corte de abajo: es parentesco real, pero prohibirlo haría imposible trabajar en un rodeo
    // cerrado que no compra genética todos los años.
    expect(matingInbreeding('PRIMO', 'PRIMA', RODEO)).toBe(0.0625);
    expect(inbreedingLevel(matingInbreeding('PRIMO', 'PRIMA', RODEO))).toBe('moderate');
  });

  it('sin parentesco da cero', () => {
    expect(matingInbreeding('TORO', 'AJENA', RODEO)).toBe(0);
    expect(matingInbreeding('AJENO', 'AJENA', RODEO)).toBe(0);
  });

  it('un pedigrí desconocido NO inventa parentesco', () => {
    // Con el pedigrí cortado, lo honesto es cero: decir «hay riesgo» sin dato bloquearía servicios
    // buenos, y el productor aprendería a apretar «forzar» siempre — que es peor que no avisar.
    expect(matingInbreeding('TORO', 'FANTASMA', RODEO)).toBe(0);
    expect(matingInbreeding('FANTASMA', 'OTRO', RODEO)).toBe(0);
  });

  it('es simétrico: da igual quién va primero', () => {
    expect(matingInbreeding('TORO', 'NIETA', RODEO)).toBe(matingInbreeding('NIETA', 'TORO', RODEO));
    expect(matingInbreeding('HIJO', 'MEDIA', RODEO)).toBe(matingInbreeding('MEDIA', 'HIJO', RODEO));
  });
});

describe('la consanguinidad se acumula entre generaciones', () => {
  it('un animal YA consanguíneo agrava el apareamiento siguiente', () => {
    // Lo que hace grave al problema: no es un evento aislado, se hereda. Aparear hermanos da una
    // cría con F = 25%; volver a aparear a esa cría dentro de la familia sube desde ahí.
    const conCruza = ped({
      TORO: [null, null],
      VACA: [null, null],
      HIJO: ['TORO', 'VACA'],
      HIJA: ['TORO', 'VACA'],
      CRUZA: ['HIJO', 'HIJA'], // hijo de hermanos enteros
      AJENA: [null, null],
      NIETA: ['HIJO', 'AJENA'],
    });
    expect(animalInbreeding('CRUZA', conCruza)).toBe(0.25);
    // Y su propio parentesco con la familia es mayor que el de un animal no consanguíneo.
    expect(matingInbreeding('CRUZA', 'NIETA', conCruza)).toBeGreaterThan(matingInbreeding('TORO', 'NIETA', conCruza));
  });

  it('F de un animal es el parentesco entre sus padres', () => {
    expect(animalInbreeding('NIETA', RODEO)).toBe(0); // HIJO × AJENA: sin parentesco
    expect(animalInbreeding('TORO', RODEO)).toBe(0); // fundador
    expect(animalInbreeding('INEXISTENTE', RODEO)).toBe(0);
  });
});

describe('un pedigrí imposible no puede colgar la pantalla de servicio', () => {
  it('UN CICLO SE CORTA EN VEZ DE COLGARSE', () => {
    // Un animal que termina siendo su propio ancestro es un dato imposible, y sin embargo entra a
    // la base con una carga mal hecha. La alternativa a cortarlo es que se cuelgue la pantalla en
    // la manga, con el productor y el animal esperando.
    const ciclo = ped({ A: ['B', null], B: ['A', null], C: ['A', 'B'] });
    expect(() => matingInbreeding('A', 'B', ciclo)).not.toThrow();
    expect(Number.isFinite(matingInbreeding('A', 'B', ciclo))).toBe(true);
    expect(() => animalInbreeding('C', ciclo)).not.toThrow();
  });

  it('un animal que es su propio padre no rompe nada', () => {
    const raro = ped({ X: ['X', null], Y: [null, null] });
    expect(() => matingInbreeding('X', 'Y', raro)).not.toThrow();
  });
});

describe('qué tan grave es, y cómo se lee', () => {
  it('EL UMBRAL DE BLOQUEO CUBRE TODO LO QUE BLOQUEABA ANTES', () => {
    // Cambio no regresivo: las cinco relaciones que el chequeo viejo bloqueaba dan todas ≥ 12,5%,
    // así que nada de lo que antes se frenaba pasa ahora. Solo se AGREGA lo que faltaba.
    const antes = [
      matingInbreeding('TORO', 'HIJA', RODEO), // padre × hija
      matingInbreeding('HIJO', 'HIJA', RODEO), // hermanos enteros
      matingInbreeding('HIJO', 'MEDIA', RODEO), // mismo padre
    ];
    for (const f of antes) expect(f).toBeGreaterThanOrEqual(INBREEDING_BLOCK_THRESHOLD);
  });

  it('clasifica por gravedad', () => {
    expect(inbreedingLevel(0)).toBe('none');
    expect(inbreedingLevel(0.03)).toBe('low');
    expect(inbreedingLevel(0.0625)).toBe('moderate');
    expect(inbreedingLevel(0.125)).toBe('high');
    expect(inbreedingLevel(0.25)).toBe('high');
  });

  it('el umbral se puede mover sin tocar la medición', () => {
    // Medir y decidir son cosas distintas: una asociación de raza o un productor pueden querer un
    // corte más estricto sin que cambie el número.
    expect(inbreedingLevel(0.0625, 0.0625)).toBe('high');
    expect(inbreedingLevel(0.0625, 0.25)).toBe('low');
  });

  it('el aviso dice qué parentesco es, no solo un número', () => {
    // «12,5%» no le dice nada a nadie; «medios hermanos o abuelo/nieta» sí.
    expect(describeInbreeding(0.25)).toContain('padre/hija');
    expect(describeInbreeding(0.125)).toContain('abuelo/nieta');
    expect(describeInbreeding(0.0625)).toContain('primos');
    expect(describeInbreeding(0)).toContain('Sin parentesco');
  });
});
