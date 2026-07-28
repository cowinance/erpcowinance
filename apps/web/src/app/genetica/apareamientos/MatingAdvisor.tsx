'use client';

import { useState } from 'react';
import { Card, EmptyState } from '@/components/ui';
import { API_URL, authHeaders } from '@/lib/api';

export interface Hembra {
  id: string;
  tag: string | null;
  name: string | null;
  /** Con qué distinguirla cuando no tiene ni nombre ni caravana: categoría y fecha de nacimiento. */
  hint?: string | null;
}

interface Candidato {
  sire_id: string;
  sire_name: string;
  tag: string | null;
  f: number;
  f_pct: number;
  level: 'none' | 'low' | 'moderate' | 'high';
  blocks: boolean;
}

const TONO: Record<Candidato['level'], string> = {
  none: 'text-success',
  low: 'text-success',
  moderate: 'text-warning',
  high: 'text-danger',
};

const ETIQUETA: Record<Candidato['level'], string> = {
  none: 'Sin parentesco',
  low: 'Parentesco lejano',
  moderate: 'Parentesco moderado',
  high: 'No conviene',
};

/**
 * Con qué toro servir a esta vaca.
 *
 * **Da vuelta la pregunta.** El sistema sabía decir «no», y solo DESPUÉS de que el productor
 * eligiera el toro y el servicio rebotara. Pero la decisión en el corral no es «¿puedo con éste?»
 * sino «¿con cuál sí?», y para contestarla el dato ya estaba en la base: el pedigrí de la finca.
 *
 * Se ordena por parentesco ascendente, así el mejor candidato queda arriba. Los que superan el
 * umbral se muestran igual, marcados: esconderlos dejaría al productor preguntándose dónde está el
 * toro que sí tiene en el potrero.
 */
export function MatingAdvisor({ hembras }: { hembras: Hembra[] }) {
  const [damId, setDamId] = useState('');
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  async function consultar(id: string) {
    setDamId(id);
    setCandidatos(null);
    if (!id) return;
    setCargando(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/genetics/inbreeding/advisor/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json();
      setCandidatos(body.sires ?? []);
    } catch {
      setError('No se pudo consultar. Reintentá.');
    } finally {
      setCargando(false);
    }
  }

  if (hembras.length === 0)
    return <EmptyState title="No hay hembras activas" body="Cargá tu hato para poder planificar los servicios." />;

  const nombre = (h: Hembra) => h.name ?? h.tag ?? (h.hint ? `Sin caravana — ${h.hint}` : 'Sin identificar');
  const recomendados = (candidatos ?? []).filter((c) => !c.blocks);

  return (
    <div className="space-y-4">
      <Card>
        <label htmlFor="dam" className="text-body font-medium">
          ¿A qué vaca vas a servir?
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            id="dam"
            value={damId}
            onChange={(e) => void consultar(e.target.value)}
            className="h-9 min-w-56 rounded-md border border-subtle bg-surface px-2 text-body"
          >
            <option value="">Elegí una…</option>
            {hembras.map((h) => (
              <option key={h.id} value={h.id}>
                {nombre(h)}
              </option>
            ))}
          </select>
          {cargando && <span className="text-label text-ink-3">Calculando parentescos…</span>}
          {error && <span className="text-label text-danger">{error}</span>}
        </div>
        <p className="mt-2 text-label text-ink-3">
          Se calcula el coeficiente de consanguinidad de la cría que saldría de cada apareamiento, mirando seis generaciones del pedigrí. Padre con
          hija da 25%; medios hermanos y abuelo con nieta, 12,5%.
        </p>
      </Card>

      {candidatos !== null && candidatos.length === 0 && (
        <EmptyState title="No hay toros activos" body="Cargá los toros de la finca para poder compararlos." />
      )}

      {candidatos !== null && candidatos.length > 0 && (
        <Card>
          {recomendados.length === 0 ? (
            <p className="mb-3 text-body">
              <span className="font-medium text-danger">Ningún toro de la finca conviene para esta vaca.</span> Todos están emparentados por encima
              del 12,5%. Es la señal de que hace falta sangre nueva: semen de afuera o un toro sin parentesco con el rodeo.
            </p>
          ) : (
            <p className="mb-3 text-body">
              Mejor opción: <span className="font-medium">{recomendados[0].sire_name}</span>
              {recomendados[0].f_pct === 0 ? ' — sin parentesco conocido.' : ` — parentesco ${recomendados[0].f_pct}%.`}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-subtle text-label text-ink-3">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Toro</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Consanguinidad de la cría</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((c) => (
                  <tr key={c.sire_id} className="border-b border-subtle last:border-0">
                    <td className="px-3 py-2">{c.sire_name}</td>
                    <td className={`tnum px-3 py-2 text-right font-medium ${TONO[c.level]}`}>{c.f_pct}%</td>
                    <td className={`px-3 py-2 text-label ${TONO[c.level]}`}>{ETIQUETA[c.level]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-caption text-ink-3">
            Un 0% con el pedigrí incompleto significa «no se conoce parentesco», no «no lo hay»: cuanto más cargada esté la genealogía, más confiable
            es el número.
          </p>
        </Card>
      )}
    </div>
  );
}
