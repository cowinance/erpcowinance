import { describe, expect, it } from 'vitest';
import { catalogLookupKeys, normalizeCatalogText } from './catalog-text';

describe('cómo se escribe en una planilla el nombre de algo del catálogo', () => {
  it('LA MAYÚSCULA NO ES INFORMACIÓN', () => {
    // La categoría se buscaba con igualdad exacta contra el código: entraba `vaca` y rebotaban
    // `Vaca`, `VACA`, `Toro`, `Novillo` y ` vaca ` con espacios. En una planilla real se escribe con
    // mayúscula inicial —que además es el NOMBRE que muestra el sistema— así que casi todas las
    // filas fallaban con «Categoría inexistente».
    for (const v of ['vaca', 'Vaca', 'VACA', ' vaca ', '  VaCa  ']) expect(normalizeCatalogText(v), v).toBe('vaca');
  });

  it('los acentos tampoco', () => {
    expect(normalizeCatalogText('Vaquillóna')).toBe('vaquillona');
  });

  it('el plural se prueba SIN recortar a ciegas', () => {
    // «Vacas» es lo que uno escribe pensando en el grupo. Se ofrecen las dos formas en vez de sacar
    // la ese siempre: si una finca creara una categoría que termina en ese, recortarla a ciegas
    // dejaría de encontrarla.
    expect(catalogLookupKeys('Vacas')).toEqual(['vacas', 'vaca']);
    expect(catalogLookupKeys('Novillos')).toEqual(['novillos', 'novillo']);
    expect(catalogLookupKeys('vaca'), 'sin ese, una sola forma').toEqual(['vaca']);
  });

  it('no propone un singular absurdo', () => {
    // Un texto de dos letras terminado en ese dejaría una sola letra, que puede chocar con
    // cualquier cosa. Mejor no ofrecerlo.
    expect(catalogLookupKeys('as')).toEqual(['as']);
  });

  it('vacío es vacío: el que consulta decide qué hacer', () => {
    expect(catalogLookupKeys('')).toEqual([]);
    expect(catalogLookupKeys('   ')).toEqual([]);
    expect(catalogLookupKeys(null)).toEqual([]);
  });
});
