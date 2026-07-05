export function formatKg(v?: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v).toLocaleString('es-AR')} kg`;
}

export function formatAdg(v?: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(2)} kg/día`;
}

export function ageFrom(birthDate?: string | null): string {
  if (!birthDate) return '—';
  const months = Math.floor((Date.now() - new Date(birthDate).getTime()) / (30.44 * 86400000));
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
  weighing: 'Pesaje',
  treatment: 'Tratamiento',
  vaccination: 'Vacunación',
  pregnancy_diagnosed: 'Diagnóstico de preñez',
  movement: 'Movimiento',
  note: 'Nota',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  sold: 'Vendido',
  dead: 'Muerto',
  culled: 'Descartado',
  lost: 'Perdido',
  transferred: 'Transferido',
};
