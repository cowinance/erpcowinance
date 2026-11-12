import { farmToday } from './date';

export function formatKg(v?: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v).toLocaleString('es-AR')} kg`;
}

export function formatAdg(v?: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(2)} kg/día`;
}

/**
 * Edad del animal, en meses de CALENDARIO.
 *
 * Antes se dividía por un mes promedio de 30,44 días, y eso corría la cuenta: un animal nacido
 * hace exactamente dos años aparecía como «1 a 11 m» en la lista del hato, y uno de nueve meses
 * como de ocho. No es un detalle de redacción — las categorías del rodeo se hablan por edad, y un
 * mes de menos cerca de un corte cambia de qué se está hablando.
 *
 * Se compara contra el día de la FINCA y no contra el reloj del equipo, y la fecha de nacimiento
 * se lee como fecha de calendario (no como instante): `new Date('2025-08-20')` es medianoche UTC,
 * que en un huso negativo es el 19 — y eso vuelve a correr la cuenta en los bordes de mes.
 */
export function ageFrom(birthDate?: string | null): string {
  if (!birthDate) return '—';
  const [an, mn, dn] = birthDate.slice(0, 10).split('-').map(Number);
  if (!an || !mn || !dn) return '—';
  const [ah, mh, dh] = farmToday().split('-').map(Number);
  let months = (ah - an) * 12 + (mh - mn);
  if (dh < dn) months--; // todavía no llegó al día del mes: el mes no está cumplido
  if (months < 0) return '—'; // fecha futura (reloj mal puesto, carga equivocada)
  if (months < 12) return `${months} m`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} a ${rem} m` : `${years} años`;
}

export function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  if (days < 365) {
    const months = Math.floor(days / 30.44);
    return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  }
  return `hace ${(days / 365).toFixed(1)} años`;
}

export function formatDate(date?: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const EVENT_LABELS: Record<string, string> = {
  birth: 'Nacimiento',
  registered: 'Alta de animal',
  weighing: 'Pesaje',
  treatment: 'Tratamiento',
  vaccination: 'Vacunación',
  heat: 'Celo',
  service: 'Servicio',
  pregnancy_diagnosed: 'Diagnóstico de preñez',
  pregnancy_negative: 'Diagnóstico negativo',
  calving: 'Parto',
  weaning: 'Destete',
  movement: 'Movimiento',
  note: 'Nota',
  edit: 'Edición de ficha',
  purchase: 'Compra',
  transfer: 'Transferencia',
  identifier_added: 'Identificador agregado',
  identifier_retired: 'Identificador retirado',
  identifier_official: 'Identificador oficial',
  cull: 'Descarte',
  loss: 'Pérdida',
  transfer_out: 'Transferencia',
  sale: 'Venta',
  mortality: 'Muerte',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  sold: 'Vendido',
  dead: 'Muerto',
  culled: 'Descartado',
  lost: 'Perdido',
  transferred: 'Transferido',
};
