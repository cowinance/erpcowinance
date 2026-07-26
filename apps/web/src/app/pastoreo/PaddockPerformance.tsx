'use client';

import { Card, CardTitle, EmptyState } from '@/components/ui';

interface Grazing {
  lot_name: string;
  entry_date: string;
  exit_date: string;
  grazing_days: number;
  animals_measured: number;
  gain_kg: number | null;
}
interface PaddockRow {
  paddock_id: string;
  paddock_name: string;
  area_ha: number | null;
  pasture_type: string | null;
  grazing_count: number;
  grazingDays: number;
  gainKg: number | null;
  gainKgPerHa: number | null;
  gainKgPerHaPerDay: number | null;
  animalsMeasured: number;
  confidence: 'sin_datos' | 'baja' | 'media' | 'alta';
  water: 'deficit' | 'normal' | 'excedente' | null;
  caveat: string | null;
  caveatKind: 'sin_datos' | 'deficit' | 'estres' | 'pocos_animales' | null;
  rain_mm: number | null;
  water_balance_mm: number | null;
  heat_stress_days: number;
  days_without_weather: number;
  grazings: Grazing[];
}

const fmt = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

const AGUA: Record<string, { label: string; tone: string }> = {
  deficit: { label: 'Déficit hídrico', tone: 'border-danger/30 bg-danger/10 text-danger' },
  normal: { label: 'Agua normal', tone: 'border-subtle text-ink-3' },
  excedente: { label: 'Excedente', tone: 'border-brand/30 bg-brand/10 text-brand' },
};

/**
 * Rendimiento por potrero (Fase 3.2).
 *
 * La tabla se ordena por kg/ha/día porque es la pregunta que decide la rotación del año siguiente.
 * Pero el orden solo NO alcanza: el clima de cada potrero va en la misma fila, porque un ranking de
 * kg/ha sin el contexto hídrico invita a sacar de la rotación un potrero que solo tuvo seca.
 *
 * Los potreros sin medir van al final y SEPARADOS: no son los peores, son los que nadie pesó, y
 * mezclarlos con los flojos llevaría a la conclusión opuesta.
 */
export function PaddockPerformance({ data }: { data: { from: string; to: string; paddocks: PaddockRow[] } }) {
  const medidos = data.paddocks.filter((p) => p.gainKgPerHaPerDay != null);
  const sinMedir = data.paddocks.filter((p) => p.gainKgPerHaPerDay == null);
  // Los avisos propios del potrero se listan uno por uno; el del clima general, una sola vez.
  const porPotrero = medidos.filter((p) => p.caveat && p.caveatKind !== 'estres');
  const delPeriodo = medidos.find((p) => p.caveatKind === 'estres')?.caveat ?? null;

  if (data.paddocks.length === 0) {
    return (
      <EmptyState
        title="Todavía no se puede comparar potreros"
        body="Hace falta al menos un pastoreo cerrado (entrada y salida) para medir cuánto produjo cada potrero."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CardTitle>Rendimiento por potrero</CardTitle>
          <span className="text-caption text-ink-3">
            {data.from} → {data.to}
          </span>
        </div>
        <p className="text-label text-ink-3">
          Kilos ganados dentro de cada pastoreo, repartidos sobre la superficie del potrero. Solo cuentan los animales pesados a la entrada <em>y</em> a la
          salida: la ganancia entre dos pesajes de potreros distintos no es de ninguno de los dos.
        </p>

        {medidos.length === 0 ? (
          <p className="mt-3 border-t border-subtle pt-3 text-body text-ink-3">
            Ningún pastoreo tiene pesajes de entrada y salida todavía. Es lo único que falta para poder comparar.
          </p>
        ) : (
          <div className="-mx-4 mt-3 overflow-x-auto px-4">
            <table className="w-full min-w-[46rem] text-body">
              <thead>
                <tr className="border-b border-subtle text-left text-caption text-ink-3">
                  <th className="py-2 font-medium">Potrero</th>
                  <th className="py-2 text-right font-medium">Sup.</th>
                  <th className="py-2 text-right font-medium">Ocupación</th>
                  <th className="py-2 text-right font-medium">Animales</th>
                  <th className="py-2 text-right font-medium">Kg ganados</th>
                  <th className="py-2 text-right font-medium">kg/ha</th>
                  <th className="py-2 text-right font-medium">kg/ha/día</th>
                  <th className="py-2 font-medium">Agua del período</th>
                </tr>
              </thead>
              <tbody>
                {medidos.map((p) => (
                  <tr key={p.paddock_id} className="border-b border-subtle align-top last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{p.paddock_name}</div>
                      <div className="text-caption text-ink-3">
                        {p.grazing_count} pastoreo{p.grazing_count === 1 ? '' : 's'} · conf. {p.confidence}
                      </div>
                    </td>
                    <td className="tnum py-2 text-right">{fmt(p.area_ha)} ha</td>
                    <td className="tnum py-2 text-right">{p.grazingDays} d</td>
                    <td className="tnum py-2 text-right">{p.animalsMeasured}</td>
                    <td className="tnum py-2 text-right">{fmt(p.gainKg, 0)}</td>
                    <td className="tnum py-2 text-right">{fmt(p.gainKgPerHa)}</td>
                    <td className="tnum py-2 text-right font-semibold">{fmt(p.gainKgPerHaPerDay, 2)}</td>
                    <td className="py-2">
                      {p.water && (
                        <span className={`rounded-full border px-2 py-0.5 text-caption font-medium ${AGUA[p.water].tone}`}>{AGUA[p.water].label}</span>
                      )}
                      <div className="tnum mt-0.5 text-caption text-ink-3">
                        {fmt(p.rain_mm, 0)} mm de lluvia · balance {fmt(p.water_balance_mm, 0)} mm
                      </div>
                      {p.days_without_weather > 0 && <div className="text-caption text-ink-3">{p.days_without_weather} días sin medición</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(porPotrero.length > 0 || delPeriodo != null) && (
        <Card>
          <CardTitle>Antes de decidir la rotación</CardTitle>
          <ul className="space-y-2">
            {porPotrero.map((p) => (
              <li key={p.paddock_id} className="text-label">
                <span className="font-medium text-ink-1">{p.paddock_name}:</span> <span className="text-ink-3">{p.caveat}</span>
              </li>
            ))}
            {/* El estrés calórico sale UNA vez: viene de una sola estación y afecta por igual a todo
                lo pastoreado en las mismas fechas. Repetirlo por fila contradice lo que el aviso dice. */}
            {delPeriodo && (
              <li className="text-label">
                <span className="font-medium text-ink-1">Todo el período:</span> <span className="text-ink-3">{delPeriodo}</span>
              </li>
            )}
          </ul>
        </Card>
      )}

      {sinMedir.length > 0 && (
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{sinMedir.length}</span>}>Ocupados pero sin medir</CardTitle>
          <p className="mb-2 text-label text-ink-3">
            No son los peores potreros: son los que nadie pesó. Pesar el lote al entrar y al salir es lo único que hace falta para que entren en la comparación.
          </p>
          <ul className="divide-y divide-subtle">
            {sinMedir.map((p) => (
              <li key={p.paddock_id} className="flex items-center justify-between py-1.5">
                <span className="text-body">{p.paddock_name}</span>
                <span className="tnum text-label text-ink-3">
                  {p.grazingDays} días en {p.grazing_count} pastoreo{p.grazing_count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
