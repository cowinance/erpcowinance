'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMatingCandidates, MATING_LABEL, MATING_TONE, type MatingCandidate } from '@/lib/mating';

/**
 * Con qué toro servir a ESTA vaca, en la ficha del animal.
 *
 * La pestaña de Reproducción dice «lista para servicio: sí» y ahí mismo aparece la pregunta que
 * sigue: ¿con cuál? Hasta ahora había que ir a otra pantalla —o peor, elegir mal y enterarse cuando
 * el servicio rebotaba con un aviso de consanguinidad.
 *
 * Se muestran los tres mejores y, aparte, los que NO convienen. Esconder a estos últimos dejaría al
 * productor preguntándose por qué no está en la lista el toro que tiene en el potrero.
 */
export function MatingSuggestion({ damId }: { damId: string }) {
  const [candidatos, setCandidatos] = useState<MatingCandidate[] | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void fetchMatingCandidates(damId).then((c) => {
      if (!vivo) return;
      setCandidatos(c);
      setCargado(true);
    });
    return () => {
      vivo = false;
    };
  }, [damId]);

  // Sin dato no se dice nada: es información de apoyo, no puede ensuciar la ficha con un error.
  if (!cargado || !candidatos || candidatos.length === 0) return null;

  const recomendados = candidatos.filter((c) => !c.blocks).slice(0, 3);
  const evitar = candidatos.filter((c) => c.blocks);

  return (
    <div className="mt-3 border-t border-subtle pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label font-medium">Con qué toro servirla</p>
        <Link href="/genetica/apareamientos" className="text-caption font-medium text-brand hover:underline">
          Ver todos →
        </Link>
      </div>

      {recomendados.length === 0 ? (
        <p className="mt-1 text-label text-danger">
          Ningún toro de la finca conviene: todos están emparentados por encima del 12,5%. Hace falta sangre nueva.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {recomendados.map((c) => (
            <li key={c.sire_id} className="flex items-baseline justify-between gap-2 text-body">
              <span>{c.sire_name}</span>
              <span className={`text-label ${MATING_TONE[c.level]}`}>
                {c.f_pct > 0 ? `${c.f_pct}% · ` : ''}
                {MATING_LABEL[c.level]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {evitar.length > 0 && (
        <p className="mt-2 text-caption text-ink-3">
          Evitar: {evitar.map((c) => `${c.sire_name} (${c.f_pct}%)`).join(', ')}
        </p>
      )}
    </div>
  );
}
