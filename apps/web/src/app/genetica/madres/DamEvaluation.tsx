import { Card, EmptyState } from '@/components/ui';

export interface Dam {
  damId: string;
  dam_name: string;
  calves: number;
  totalWeanedKg: number;
  years: number;
  kgPerYear: number;
  avgWeaningKg: number;
  lastWeaningDate: string | null;
  confidence: 'baja' | 'media' | 'alta';
  donatedCalves: number;
  geneticKgPerYear: number;
  isDonor: boolean;
  impossibleIntervals: number;
}

export interface DamReport {
  as_of: string;
  total: number;
  with_impossible_intervals?: number;
  cull_candidates: Dam[];
  dams: Dam[];
}

/**
 * Evaluación de vientres: con qué vacas quedarse.
 *
 * La columna que ordena es **kg destetados por año**, no el peso al destete. La diferencia no es de
 * matiz: una vaca que desteta 220 kg pero se saltea un año de cada dos produce menos que una de 200
 * kg que no falla nunca — y mirando solo el kilaje, la primera parece la mejor madre. Por eso las
 * dos columnas están al lado, y por eso la tabla se ordena por la de la derecha.
 */
export function DamEvaluation({ report }: { report: DamReport }) {
  if (report.dams.length === 0)
    return (
      <EmptyState
        title="Todavía no hay vientres para evaluar"
        body="Hace falta que las vacas tengan partos registrados y que sus terneros tengan peso al destete. Con eso el sistema calcula cuántos kilos produce cada vaca por año en el rodeo."
      />
    );

  const descarte = new Set(report.cull_candidates.map((d) => d.damId));
  // La columna genética SOLO aparece si la finca hace transferencia. Para las demás sería una
  // columna que repite exactamente la de al lado, y una tabla con dos números idénticos hace dudar
  // de los dos.
  const hayDonantes = report.dams.some((d) => d.isDonor);
  const mejorPorCria = [...report.dams].sort((a, b) => b.avgWeaningKg - a.avgWeaningKg)[0];
  const mejorPorAnio = report.dams[0];
  // Cuando la mejor por cría no es la mejor por año, la tabla está diciendo algo que el ojo no ve.
  const tension = mejorPorCria.damId !== mejorPorAnio.damId && mejorPorCria.calves > 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-body font-medium">{report.total} vientres con parto registrado</span>
          <span className="text-label text-ink-3">
            Los kilos se reparten entre los años que la vaca lleva en el rodeo desde su primer parto. Así el número junta fertilidad, leche y genética:
            una vaca que no preña un año produce cero ese año, y se nota.
          </span>
        </div>
      </Card>

      {tension && (
        <Card>
          <p className="text-body">
            <span className="font-medium">{mejorPorCria.dam_name}</span> es la que desteta más pesado (
            <span className="tnum">{mejorPorCria.avgWeaningKg}</span> kg por cría), pero{' '}
            <span className="font-medium">{mejorPorAnio.dam_name}</span> produce más por año (
            <span className="tnum">{mejorPorAnio.kgPerYear}</span> contra <span className="tnum">{mejorPorCria.kgPerYear}</span> kg).
          </p>
          <p className="mt-1 text-label text-ink-3">
            Es la razón de mirar esta tabla y no el kilaje al destete: la diferencia está en cuántas veces parió, no en cuánto crió cada ternero.
          </p>
        </Card>
      )}

      {(report.with_impossible_intervals ?? 0) > 0 && (
        <Card>
          <p className="text-body font-medium">
            {report.with_impossible_intervals} {report.with_impossible_intervals === 1 ? 'vientre tiene' : 'vientres tienen'} partos imposibles
          </p>
          <p className="mt-0.5 text-label text-ink-3">
            Dos partos más cerca que una gestación: la vaca habría tenido que quedar preñada antes de parir. Casi siempre son mellizos cargados como
            dos partos, una fecha mal tipeada, o el parto anotado en otra vaca. Mientras las fechas estén así, sus kilos por año están inflados y no se
            los compara con el rodeo.
          </p>
        </Card>
      )}

      {report.cull_candidates.length > 0 && (
        <Card>
          <p className="text-body font-medium">Vientres por debajo del rodeo</p>
          <p className="mt-0.5 text-label text-ink-3">
            Producen menos del 75% de la mediana. Es una sugerencia para mirarlas, no una orden: puede haber un motivo que el sistema no sabe.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {report.cull_candidates.map((d) => (
              <span key={d.damId} className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-label">
                {d.dam_name} · <span className="tnum">{d.kgPerYear}</span> kg/año
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-subtle text-label text-ink-3">
                <th scope="col" className="px-3 py-2 text-left font-medium">Vaca</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Crías</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Años</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Promedio por cría</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Kg por año</th>
                {hayDonantes && <th scope="col" className="px-3 py-2 text-right font-medium">Kg genéticos/año</th>}
                <th scope="col" className="px-3 py-2 text-left font-medium">Último destete</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Confianza</th>
              </tr>
            </thead>
            <tbody>
              {report.dams.map((d) => (
                <tr key={d.damId} className="border-b border-subtle last:border-0">
                  <td className="px-3 py-2">
                    {d.dam_name}
                    {d.isDonor && <span className="ml-2 text-caption text-brand">donante</span>}
                    {d.impossibleIntervals > 0 && (
                      <span className="ml-2 text-caption text-danger">
                        {d.impossibleIntervals} {d.impossibleIntervals === 1 ? 'parto imposible' : 'partos imposibles'}
                      </span>
                    )}
                    {descarte.has(d.damId) && <span className="ml-2 text-caption text-warning">por debajo del rodeo</span>}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">{d.calves}</td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">{d.years}</td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">{d.avgWeaningKg || '—'}</td>
                  <td className="tnum px-3 py-2 text-right font-medium">{d.kgPerYear}</td>
                  {hayDonantes && (
                    <td className="tnum px-3 py-2 text-right text-ink-2">
                      {d.geneticKgPerYear}
                      {d.donatedCalves > 0 && <span className="ml-1 text-caption text-ink-3">({d.donatedCalves} donada{d.donatedCalves > 1 ? 's' : ''})</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-ink-2">{d.lastWeaningDate ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-3">{d.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hayDonantes && (
          <p className="mt-2 text-caption text-ink-3">
            «Kg por año» es lo que la vaca CRIÓ —gestó y amamantó—, que es lo que decide un descarte. «Kg genéticos» suma además las crías con sus
            genes que gestó otra vaca. A una donante no se la marca por criar poco: su trabajo es dar embriones.
          </p>
        )}
        <p className="mt-2 text-caption text-ink-3">
          «Confianza baja» es una vaca con un solo destete: no alcanza para decidir. Una vaca deja una cría por año, así que los umbrales no son los de
          un toro.
        </p>
      </Card>
    </div>
  );
}
