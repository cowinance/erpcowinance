/**
 * Cómo se escribe en una planilla el nombre de algo del catálogo.
 *
 * **Por qué hace falta.** La categoría del animal se buscaba con igualdad exacta contra el CÓDIGO,
 * así que solo entraba en minúscula perfecta. Medido contra la app: `vaca` entraba; `Vaca`, `VACA`,
 * `Toro`, `Novillo`, `Vaquillona`, `TERNERA` y ` vaca ` con espacios, todas rechazadas con
 * «Categoría inexistente». En una planilla real la categoría se escribe con mayúscula inicial —que
 * además es el NOMBRE que muestra el sistema, «Vaca»— así que casi todas las filas rebotaban.
 *
 * Es el mismo bug que ya se había arreglado en el sexo, y por la misma razón: mayúsculas, acentos y
 * espacios son ruido de tipeo, no información. Al sexo se le puso un parser tolerante y al campo de
 * al lado no.
 *
 * **Contra qué se compara.** Contra el código Y el nombre: el productor escribe «Vaca» porque es lo
 * que ve en pantalla, no `vaca`, que es un identificador interno.
 *
 * **El plural.** «Vacas» y «Terneros» son lo que uno escribe cuando piensa en el grupo. Se prueban
 * las DOS formas —con y sin la ese final— en vez de recortarla siempre: si alguna finca creara una
 * categoría que termina en ese, recortar a ciegas dejaría de encontrarla.
 *
 * Puro, sin IO.
 */

/** Deja el texto en su forma comparable: sin acentos, sin mayúsculas, sin espacios de sobra. */
export function normalizeCatalogText(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Las formas con las que buscar este texto en el catálogo.
 *
 * Devuelve la normalizada y, si termina en ese, también la singular. Nunca vacía salvo que la
 * entrada lo esté — el que consulta decide qué hacer con eso.
 */
export function catalogLookupKeys(raw: unknown): string[] {
  const base = normalizeCatalogText(raw);
  if (!base) return [];
  const singular = base.endsWith('s') ? base.slice(0, -1) : null;
  return singular && singular.length >= 2 ? [base, singular] : [base];
}
