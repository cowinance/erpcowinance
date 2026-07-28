import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { MatingAdvisor, type Hembra } from './MatingAdvisor';

/**
 * Genética — con qué toro servir.
 *
 * Da vuelta la pregunta. El sistema sabía decir «no» y solo DESPUÉS de que el productor eligiera:
 * el servicio rebotaba con un aviso de consanguinidad. Pero la decisión en el corral no es «¿puedo
 * con éste?» sino «¿con cuál sí?», y el dato para contestarla ya estaba en la base.
 */
export default async function MatingPage() {
  const animals = await apiSafe<any>('/animals?sex=F&limit=200');
  if (animals === null) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  // Una recién nacida todavía no tiene caravana —el parto la crea sin identificador—, así que sin
  // esto el desplegable se llena de «Sin identificar» iguales entre sí y no se puede elegir. Se
  // muestran igual: esconderlas dejaría al productor buscando un animal que sí tiene en el potrero.
  const hembras: Hembra[] = (Array.isArray(animals) ? animals : (animals.data ?? []))
    .map((a: any) => ({
      id: a.id,
      tag: a.tag ?? null,
      name: a.name ?? null,
      hint: [a.category, a.birth_date ? `nacida ${String(a.birth_date).slice(0, 10)}` : null].filter(Boolean).join(' · ') || null,
    }))
    .sort((a: Hembra, b: Hembra) => (a.name ?? a.tag ?? 'zz').localeCompare(b.name ?? b.tag ?? 'zz'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Con qué toro servir a cada vaca, según el parentesco real del rodeo.</p>
      </div>
      <GeneticsNav />
      <MatingAdvisor hembras={hembras} />
    </div>
  );
}
