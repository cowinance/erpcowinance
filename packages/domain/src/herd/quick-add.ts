/**
 * Alta rápida de un animal, parado en el corral.
 *
 * **Por qué existe.** Dar de alta era lo único que el productor no podía hacer desde el teléfono:
 * el menú de captura tiene once acciones y las once operan sobre un animal que YA está cargado. El
 * animal se registra donde está el animal —en la manga, cuando baja el camión— y para eso había que
 * volver a la computadora.
 *
 * **Qué valida y qué NO.** Tres campos obligatorios (caravana, sexo, categoría) y un aviso por
 * caravana repetida. Nada más: es un alta RÁPIDA y el resto —raza, madre, padre, fecha exacta— se
 * completa después desde la web, donde hay pantalla y tiempo.
 *
 * **Por qué la repetida AVISA y no BLOQUEA.** Es la misma semántica que el servidor: `AnimalSyncHandler`
 * acepta el alta y registra un conflicto de tipo `duplicate` como «propuesta de fusión», no la
 * rechaza. Bloquear acá inventaría una regla más dura que la del servidor, y dejaría al productor
 * trabado en el corral sin forma de salir. Avisar le da lo que necesita: enterarse ANTES de guardar,
 * cuando todavía tiene el animal adelante y puede releer la caravana.
 *
 * El aviso nombra al animal que ya la tiene y su estado, porque la decisión cambia con eso: si el
 * otro está muerto, reusar la caravana es práctica normal de campo; si está activo, casi siempre es
 * un error de tipeo.
 *
 * **Contra qué compara.** Contra lo que el dispositivo tiene bajado, que es la finca entera (el
 * primer ingreso la descarga). No es una garantía de unicidad global —dos teléfonos sin señal pueden
 * crear la misma caravana— y por eso el servidor vuelve a mirar. Acá se atrapa el 99% de los casos
 * en el único momento en que el error es barato de corregir.
 *
 * Puro, sin IO ni relojes.
 */

import { TagNumber } from '../value-objects/tag-number';

/** Un animal ya conocido por el dispositivo, para detectar la caravana repetida. */
export interface KnownAnimal {
  readonly tag: string | null | undefined;
  /** `active`, `dead`, `sold`… — cambia el consejo, no la regla. */
  readonly status?: string | null;
}

export interface QuickAddInput {
  readonly tag: string;
  readonly sex: 'F' | 'M' | null;
  readonly categoryCode: string | null;
}

export interface QuickAddIssue {
  readonly field: 'tag' | 'sex' | 'category';
  readonly message: string;
}

export interface QuickAddResult {
  /** Impiden guardar: falta un dato sin el cual el animal no existe. */
  readonly errors: QuickAddIssue[];
  /** No impiden guardar; se confirman. Hoy: la caravana repetida. */
  readonly warnings: QuickAddIssue[];
  /** La caravana normalizada — la que hay que guardar, no la que se tipeó. */
  readonly tag: string;
}

/** Un estado terminal se dice distinto: reusar la caravana de un animal que ya no está es normal. */
function seFue(status: string | null | undefined): boolean {
  return status === 'dead' || status === 'sold' || status === 'culled';
}

export function validateQuickAdd(input: QuickAddInput, yaEnElDispositivo: Iterable<KnownAnimal> = []): QuickAddResult {
  const errors: QuickAddIssue[] = [];
  const warnings: QuickAddIssue[] = [];

  // La caravana se normaliza con el VO, que es donde vive esa regla: la misma caravana escrita con
  // espacios de más es la misma caravana.
  const tag = TagNumber.isValid(input.tag) ? TagNumber.of(input.tag) : '';
  if (!tag) errors.push({ field: 'tag', message: 'Falta la caravana' });
  if (!input.sex) errors.push({ field: 'sex', message: 'Falta el sexo' });
  if (!input.categoryCode) errors.push({ field: 'category', message: 'Falta la categoría' });

  if (tag) {
    for (const otro of yaEnElDispositivo) {
      // Sin `!suyo`: el vacío no puede coincidir porque acá `tag` ya se sabe no vacío — el guard de
      // afuera lo garantiza, y escribirlo dos veces sugiere una protección que no está donde parece.
      const suyo = typeof otro.tag === 'string' ? otro.tag.trim() : '';
      if (suyo !== tag) continue;
      warnings.push({
        field: 'tag',
        message: seFue(otro.status)
          ? `La caravana ${tag} fue de un animal que ya no está en el rodeo. Si la estás reusando, está bien.`
          : `La caravana ${tag} ya la tiene un animal activo. Revisá el número antes de guardar.`,
      });
      break;
    }
  }

  return { errors, warnings, tag };
}
