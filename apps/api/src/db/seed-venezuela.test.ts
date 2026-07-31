import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidRif, parseRif } from '@cowinance/domain';
import { countryDefaults } from '../modules/identity/country-defaults';

/**
 * La demo tiene que ser coherente con el país del producto.
 *
 * **Por qué existe este archivo.** El seed decía Argentina —pesos, `es-AR`, zona de Buenos Aires—
 * mientras el vertical fiscal se construía sobre el SENIAT y el RIF, y las ventas ya se emitían en
 * dólares. Nadie lo vio porque nada lo miraba: son datos de demo, no hay tipo que los ate al país.
 *
 * Y en esa grieta se coló un RIF INVÁLIDO (`J-30158742-6`, que no cerraba el dígito verificador) y
 * vivió ahí sin molestar, porque con el país en `AR` el validador ni siquiera corre. El día que el
 * país pasa a `VE` deja de ser un detalle: `resolveFiscalId` valida toda alta que entre por la API,
 * y del RIF del emisor sale la identidad del comprobante fiscal.
 *
 * Se lee el ARCHIVO y no la base a propósito: así el test corre en el gate de siempre, sin levantar
 * Postgres, y falla en el momento en que alguien escribe el valor equivocado — no cuando lo siembra.
 */

const SEED = readFileSync(resolve(__dirname, 'seed.ts'), 'utf8');

/**
 * Solo la parte DEMO, desde `seedDemo` hasta el final.
 *
 * El corte no es un detalle: arriba está `bootstrapCatalogs`, y ahí el peso argentino y las razas
 * del Cono Sur TIENEN que seguir existiendo —igual que el bolívar existe aunque la moneda funcional
 * sea el dólar—. Buscar «ARS» en el archivo entero da un falso positivo contra el catálogo, que es
 * exactamente lo que pasó la primera vez que corrió este test.
 */
const DEMO = SEED.slice(SEED.indexOf('export async function seedDemo'));

/** Todos los RIF literales del seed, en su forma canónica `X-00000000-0`. */
const rifsDelSeed = [...DEMO.matchAll(/'([JGVEP]-\d{8}-\d)'/g)].map((m) => m[1]);

describe('el seed es venezolano, como el producto', () => {
  it('encuentra RIF para revisar (si no, este archivo no está probando nada)', () => {
    // Guarda contra el peor final: que alguien cambie el formato, la expresión deje de encontrar
    // nada y los tests de abajo pasen sobre una lista vacía.
    expect(rifsDelSeed.length).toBeGreaterThanOrEqual(3);
  });

  it('TODOS los RIF cierran el dígito verificador', () => {
    // El caso que estaba mal. `J-30158742-6` no cerraba y nadie lo notó.
    const malos = rifsDelSeed.filter((r) => !isValidRif(r));
    expect(malos, `RIF con dígito inválido: ${malos.join(', ')}`).toEqual([]);
  });

  it('cada RIF viaja con su forma NORMALIZADA al lado', () => {
    // La unicidad se apoya en la columna normalizada, nunca en `tax_id`. El seed inserta por SQL
    // directo, así que no pasa por `resolveFiscalId` —quien la llena en un alta real— y sin esto
    // la demo queda distinta de lo que produce el sistema.
    for (const rif of rifsDelSeed) {
      const { prefix, body, checkDigit } = parseRif(rif);
      const normalizado = `${prefix}${body}${checkDigit}`;
      expect(DEMO, `falta '${normalizado}' junto a ${rif}`).toContain(`'${normalizado}'`);
    }
  });

  it('no quedan valores de otro país en la organización de demo', () => {
    // Se buscan los literales, que es como estaban escritos. `countryDefaults('VE')` es la fuente
    // de lo que SÍ tiene que haber, así que si mañana cambia un default, este test lo sigue.
    for (const ajeno of ["'ARS'", "'es-AR'", "'America/Argentina/Buenos_Aires'", "'AR'"]) {
      expect(DEMO, `${ajeno} es de la etapa argentina`).not.toContain(ajeno);
    }
    const ve = countryDefaults('VE');
    expect(ve.currency, 'el productor descartó el bolívar: la moneda funcional es el dólar').toBe('USD');
    // Los valores se LEEN de la fuente canónica en vez de escribirse a mano, así la demo no puede
    // quedar distinta de lo que produce el alta de un tenant real.
    expect(DEMO).toContain(`countryDefaults('VE')`);
  });

  it('el catálogo de razas del Cono Sur NO se borra', () => {
    // Sacar una raza de un catálogo desplegado dejaría animales apuntando a algo que ya no existe.
    // Lo que cambió es qué razas se le asignan al rodeo de DEMO, no qué razas existen.
    for (const raza of ["'angus'", "'hereford'", "'brangus'", "'braford'"]) {
      expect(SEED, `${raza} tiene que seguir en el catálogo`).toContain(raza);
    }
  });

  it('el rodeo de demo NO es de razas de clima templado', () => {
    // Angus y Hereford en el trópico no se sostienen, y la raza sale en la ficha de cada animal:
    // era lo más visible del error. La asignación es la línea del `pick`.
    const asignacion = /const breedCode = pick\(\[([^\]]+)\]\)/.exec(DEMO)?.[1] ?? '';
    expect(asignacion, 'no se encontró la asignación de raza').not.toBe('');
    for (const templada of ['angus', 'hereford', 'brangus', 'braford', 'holando']) {
      expect(asignacion, `${templada} no va en un rodeo venezolano`).not.toContain(templada);
    }
    expect(asignacion, 'la base del rodeo tropical es cebuína').toContain('brahman');
  });
});
