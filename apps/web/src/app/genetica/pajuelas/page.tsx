import { cryoLocationLabel } from '@cowinance/domain';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { StrawManager } from './StrawManager';

/**
 * Inventario físico de una partida o de una colecta (GT-2).
 *
 * Es la pantalla del inventario del termo: se abre desde el listado tocando «N sin ubicar», que es
 * el momento en que alguien decide ir a buscarlas.
 */
export default async function StrawsPage({
  searchParams,
}: {
  searchParams: Promise<{ semen_batch_id?: string; embryo_id?: string }>;
}) {
  const { semen_batch_id: semen, embryo_id: embryo } = await searchParams;
  if (!semen && !embryo)
    return (
      <div className="space-y-6">
        <GeneticsNav />
        <EmptyState title="Elegí una partida" body="Desde Semen o Embriones, tocá «sin ubicar» para inventariar sus pajuelas." />
      </div>
    );

  const query = semen ? `semen_batch_id=${semen}` : `embryo_id=${embryo}`;
  const [straws, tanks] = await Promise.all([apiSafe<any[]>(`/genetics/straws?${query}`), apiSafe<any[]>('/genetics/cryo/tanks')]);
  if (straws === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  // El destino se arma con el árbol completo de cada termo. Se piden los termos y su detalle acá,
  // en el servidor, para que el selector llegue listo: elegir un gobelete es la acción principal de
  // la pantalla y no puede depender de una segunda vuelta al servidor.
  const detalles = await Promise.all((tanks ?? []).map((t) => apiSafe<any>(`/genetics/cryo/tanks/${t.id}`)));
  const goblets = detalles.flatMap((t: any) =>
    (t?.canisters ?? []).flatMap((c: any) =>
      (c.goblets ?? []).map((g: any) => ({
        id: g.id,
        label: cryoLocationLabel({ tank_code: t.code, canister_code: c.code, canister_color: c.color, goblet_code: g.code }),
      })),
    ),
  );

  const owner = semen ? await apiSafe<any>(`/genetics/semen/${semen}`) : await apiSafe<any>(`/genetics/embryos/${embryo}`);
  const title = semen ? `Pajuelas de ${owner?.batch_code ?? 'la partida'}` : `Embriones de la colecta`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Cada pajuela es una unidad con su propia ubicación e historia. El saldo de la partida es el resultado de contarlas.
        </p>
      </div>
      <GeneticsNav />
      {goblets.length === 0 && (
        <EmptyState
          title="Todavía no hay gobeletes"
          // Mandaba a «la pestaña Termos» sin llevar. Un aviso que nombra el lugar al que hay que ir
          // y no es un enlace obliga a buscarlo, y acá la búsqueda termina mal: el gobelete está dos
          // niveles adentro del termo y la pantalla de destino no lo dice.
          body="La ubicación va en tres niveles: el termo, sus canastas y los gobeletes de cada canasta. Creá al menos un gobelete y las pajuelas van a poder ubicarse ahí."
          actionHref="/genetica/termos"
          actionLabel="Cargar la estructura del termo"
        />
      )}
      <StrawManager title={title} straws={straws ?? []} goblets={goblets} ownerParam={query} />
    </div>
  );
}
