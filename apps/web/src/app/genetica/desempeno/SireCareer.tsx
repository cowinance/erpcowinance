import { Card } from '@/components/ui';

export interface Career {
  years: number[];
  sires: {
    sireId: string;
    sire_name: string;
    n: number;
    index: number;
    confidence: 'baja' | 'media' | 'alta';
    years: number[];
    by_year: { year: number; n: number; index: number }[];
  }[];
}

/**
 * El toro a lo largo de su carrera, no de una temporada.
 *
 * Con 8 terneros por parición la confianza es «baja» siempre, y con eso no se decide una compra.
 * Sumadas tres temporadas son 24 y ya es «media». Lo que se combina son los ÍNDICES y no los kilos:
 * los pesos de años distintos no son comparables —un año seco baja a todos— y promediarlos le
 * atribuiría a la genética lo que fue la lluvia.
 */
export function SireCareer({ career }: { career: Career | null }) {
  if (!career || career.sires.length === 0 || career.years.length < 2) return null;

  return (
    <Card>
      <div className="mb-3">
        <p className="text-body font-medium">Trayectoria: {career.years.length} pariciones</p>
        <p className="mt-0.5 text-label text-ink-3">
          Los índices de todas las temporadas del toro, combinados y ponderados por cuántos terneros aportó cada una. Un índice de una sola parición
          casi nunca alcanza para decidir una compra; sumadas, sí.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-subtle text-label text-ink-3">
              <th scope="col" className="px-3 py-2 text-left font-medium">Toro</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Terneros</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Índice</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Confianza</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Por temporada</th>
            </tr>
          </thead>
          <tbody>
            {career.sires.map((s) => (
              <tr key={s.sireId} className="border-b border-subtle last:border-0">
                <td className="px-3 py-2">{s.sire_name}</td>
                <td className="tnum px-3 py-2 text-right text-ink-2">{s.n}</td>
                <td className={`tnum px-3 py-2 text-right font-medium ${s.index >= 100 ? 'text-success' : 'text-ink-2'}`}>{s.index}</td>
                <td className="px-3 py-2 text-ink-3">{s.confidence}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {s.by_year.map((y) => (
                      <span key={y.year} className="rounded border border-subtle px-1.5 py-0.5 text-caption text-ink-2">
                        {y.year}: <span className="tnum">{y.index}</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-ink-3">
        100 es el promedio de sus contemporáneos. El detalle por temporada muestra si el toro viene mejorando o si un solo año lo salvó.
      </p>
    </Card>
  );
}
