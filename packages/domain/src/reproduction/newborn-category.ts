/**
 * Código de categoría zootécnica de una cría bovina al nacer, según su sexo.
 *
 * Regla acotada deliberadamente: SOLO al nacimiento (edad = 0 siempre),
 * SOLO bovino. No es "classifyCategory" completo (especie + sexo + edad con
 * catálogo configurable, reclasificación automática) — esa es una capacidad
 * de producto que no existe hoy en el sistema y queda fuera de este sprint
 * (ver ADR-0006, extensión F4.3: no se construye sin comportamiento real
 * que preservar).
 *
 * Comportamiento actual preservado tal cual: cualquier valor que no sea
 * exactamente 'M' se trata como hembra ('ternera') — incluida la ausencia
 * de sexo. Deliberadamente NO valida con el VO `Sex` acá: eso introduciría
 * una excepción donde hoy no la hay (cambio de comportamiento no aprobado
 * para esta extracción).
 */
export type NewbornCategoryCode = 'ternero' | 'ternera';

export function newbornCategoryCode(sex: unknown): NewbornCategoryCode {
  return sex === 'M' ? 'ternero' : 'ternera';
}
