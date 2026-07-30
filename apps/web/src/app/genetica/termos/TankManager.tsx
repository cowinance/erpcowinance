'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { CRYO_COLORS, cryoLocationLabel, isKnownCryoColor } from '@cowinance/domain';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Goblet {
  id: string;
  code: string;
  color: string | null;
}
interface Canister {
  id: string;
  code: string;
  color: string | null;
  goblet_capacity: number | null;
  goblet_count: number;
  goblets: Goblet[];
}
/** «1 gobeletes» delata que nadie miró la pantalla con un solo gobelete cargado. */
const plural = (n: number, singular: string) => `${n} ${singular}${n === 1 ? '' : 's'}`;

interface Tank {
  id: string;
  code: string;
  name: string | null;
  canister_capacity: number | null;
  canister_count: number;
  canisters?: Canister[];
}

/** Chip de color: solo se pinta lo que la paleta conoce; lo demás se muestra como texto. */
const SWATCH: Record<string, string> = {
  azul: '#2563eb',
  rojo: '#dc2626',
  verde: '#16a34a',
  amarillo: '#eab308',
  blanco: '#f5f5f4',
  negro: '#1c1917',
  naranja: '#ea580c',
  violeta: '#7c3aed',
};

function ColorDot({ color }: { color: string | null }) {
  if (!isKnownCryoColor(color)) return null;
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-full border border-strong"
      style={{ backgroundColor: SWATCH[color] }}
    />
  );
}

/**
 * Gestor de la estructura del termo (GT-1).
 *
 * Se muestra el árbol entero abierto, sin acordeones: frente al termo lo que se necesita es ver de
 * un vistazo qué canasta es cuál. Un panel que hay que ir desplegando obliga a recordar dónde
 * estaba lo que se buscaba, justo cuando las manos están ocupadas.
 */
export function TankManager({ tanks, selected }: { tanks: Tank[]; selected: Tank | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tankCode, setTankCode] = useState('');
  const [tankName, setTankName] = useState('');
  const [tankCap, setTankCap] = useState('');
  const [canCode, setCanCode] = useState('');
  const [canColor, setCanColor] = useState('');
  const [canGob, setCanGob] = useState('');
  const [gobFor, setGobFor] = useState<string | null>(null);
  const [gobCode, setGobCode] = useState('');
  const [gobColor, setGobColor] = useState('');
  // Plegado si ya hay termos: la primera vez es el paso obligado, después estorba.
  const [nuevoAbierto, setNuevoAbierto] = useState(tanks.length === 0);

  async function call(method: string, path: string, data?: any, onOk?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      onOk?.();
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
     * El ORDEN de la pantalla, que era el problema real.
     *
     * «Nuevo termo» estaba primero y ocupaba la pantalla entera en una ventana angosta: quien
     * llegaba a ubicar una pajuela veía un formulario para crear OTRO termo —que ya tenía— y el
     * panel donde se trabaja quedaba debajo del pliegue. Reportado desde producción: «no tengo la
     * opción de registrar los gobeletes», con el arreglo anterior ya desplegado. Aquel fue de
     * TEXTO, y el texto no se lee si está fuera de la pantalla.
     *
     * Ahora manda el trabajo: en angosto va primero el termo elegido con sus canastas, y crear un
     * termo queda plegado — es algo que se hace una vez, no todos los días.
     */
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <div className="space-y-4 self-start max-lg:order-2">
        <Card>
          <CardTitle
            action={
              tanks.length > 0 ? (
                <button onClick={() => setNuevoAbierto((v) => !v)} className="text-label font-medium text-brand hover:underline">
                  {nuevoAbierto ? 'Cerrar' : 'Abrir'}
                </button>
              ) : undefined
            }
          >
            Nuevo termo
          </CardTitle>
          {error && (
            <p role="alert" className="mb-2 text-label text-danger">
              {error}
            </p>
          )}
          <div className={`space-y-2 ${nuevoAbierto ? '' : 'hidden'}`}>
            <Input
              value={tankCode}
              onChange={(e) => setTankCode(e.target.value)}
              placeholder="Número, p. ej. 207"
              aria-label="Número del termo"
            />
            <Input
              value={tankName}
              onChange={(e) => setTankName(e.target.value)}
              placeholder="Nombre (opcional)"
              aria-label="Nombre del termo"
            />
            <Input
              value={tankCap}
              onChange={(e) => setTankCap(e.target.value)}
              inputMode="numeric"
              placeholder="Cuántas canastas entran (opcional)"
              aria-label="Capacidad en canastas"
            />
            <Button
              size="sm"
              loading={busy}
              disabled={!tankCode.trim()}
              onClick={() =>
                call('POST', '/genetics/cryo/tanks', { code: tankCode, name: tankName, canister_capacity: tankCap }, () => {
                  setTankCode('');
                  setTankName('');
                  setTankCap('');
                })
              }
            >
              Agregar termo
            </Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Termos</CardTitle>
          {tanks.length === 0 ? (
            <p className="text-body text-ink-3">Todavía no cargaste ninguno. Empezá por el de arriba.</p>
          ) : (
            <ul className="space-y-1">
              {tanks.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/genetica/termos?tank=${t.id}`}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-body hover:bg-brand-soft ${selected?.id === t.id ? 'bg-brand-soft font-medium' : ''}`}
                  >
                    <span className="truncate">
                      {t.code}
                      {t.name ? <span className="text-ink-3"> · {t.name}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-caption text-ink-3">
                      {t.canister_capacity
                        ? `${t.canister_count}/${t.canister_capacity} canastas`
                        : plural(t.canister_count, 'canasta')}
                      {/* El renglón ABRE la estructura del termo, y sin nada que lo indique se leía
                          como un dato más de una lista. La pantalla de al lado dice «elegí un termo»
                          sin que nada parezca elegible. */}
                      <ChevronRight size={14} strokeWidth={2} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="col-span-2 max-lg:order-1 max-lg:col-span-1">
        {!selected ? (
          <EmptyState
            title={tanks.length === 0 ? 'Empezá por cargar el termo' : 'Elegí un termo'}
            // La cadena tiene TRES niveles y no estaba dicha en ninguna parte. Quien llegaba
            // buscando dónde crear un gobelete —mandado por el aviso de Pajuelas— veía «elegí un
            // termo» y no tenía cómo saber que el gobelete estaba dos niveles más adentro.
            body={
              tanks.length === 0
                ? 'La ubicación va en tres niveles: el termo, las canastas que tiene adentro y los gobeletes de cada canasta. Las pajuelas se guardan en el gobelete.'
                : 'Tocá uno de la lista para ver y editar sus canastas, y los gobeletes de cada canasta.'
            }
          />
        ) : (
          <Card>
            <CardTitle>
              <span>
                Termo {selected.code}
                {selected.name ? <span className="font-normal text-ink-3"> · {selected.name}</span> : null}
              </span>
              <span className="text-caption font-normal text-ink-3">
                {selected.canister_capacity
                  ? `${selected.canister_count} de ${selected.canister_capacity} canastas`
                  : plural(selected.canister_count, 'canasta')}
              </span>
            </CardTitle>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2">
              <Input
                value={canCode}
                onChange={(e) => setCanCode(e.target.value)}
                placeholder="N.º de canasta"
                aria-label="Número de canasta"
                controlSize="sm"
                className="w-32"
              />
              <Select
                value={canColor}
                onChange={(e) => setCanColor(e.target.value)}
                controlSize="sm"
                aria-label="Color de la canasta"
                className="w-36"
              >
                <option value="">Sin color</option>
                {CRYO_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              {/*
                Cuántos gobeletes entran. Se pide ACÁ porque el sistema los crea numerados del 1 en
                adelante: son las posiciones físicas de la canasta, y cargarlas de a una era la
                ceremonia que dejaba las pajuelas sin ubicar.
              */}
              <Input
                value={canGob}
                onChange={(e) => setCanGob(e.target.value)}
                inputMode="numeric"
                placeholder="Gobeletes"
                aria-label="Cuántos gobeletes entran en la canasta"
                controlSize="sm"
                className="w-28"
              />
              <Button
                size="sm"
                loading={busy}
                disabled={!canCode.trim()}
                onClick={() =>
                  call('POST', `/genetics/cryo/tanks/${selected.id}/canisters`, { code: canCode, color: canColor, goblet_capacity: canGob ? Number(canGob) : null }, () => {
                    setCanCode('');
                    setCanGob('');
                  })
                }
              >
                Agregar canasta
              </Button>
            </div>

            {error && (
              <p role="alert" className="mb-2 text-label text-danger">
                {error}
              </p>
            )}

            {(selected.canisters ?? []).length === 0 ? (
              <p className="text-body text-ink-3">
                El termo todavía no tiene canastas. Los gobeletes van adentro de una canasta, así que
                este es el paso previo para poder ubicar pajuelas.
              </p>
            ) : (
              <ul className="space-y-3">
                {(selected.canisters ?? []).map((c) => (
                  <li key={c.id} className="rounded-md border border-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-body font-medium">
                        <ColorDot color={c.color} />
                        {c.color ? `${c.color} ${c.code}` : `Canasta ${c.code}`}
                        <span className="font-normal text-ink-3">
                          ·{' '}
                          {c.goblet_capacity
                            ? `${c.goblet_count}/${c.goblet_capacity} gobeletes`
                            : plural(c.goblet_count, 'gobelete')}
                        </span>
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setGobFor(gobFor === c.id ? null : c.id)}
                          className="h-7 rounded-md border border-strong bg-surface px-2 text-label hover:bg-brand-soft"
                        >
                          {/*
                            «Agregar gobelete» y no «Gobelete». Decía el sustantivo, al lado de
                            «Quitar», mientras TODAS las demás acciones de la pantalla dicen el verbo
                            —«Agregar termo», «Agregar canasta»—. Se leía como una etiqueta y no como
                            un botón, y es el único lugar de la app donde se crea un gobelete: quien
                            lo buscaba llegaba hasta acá y no lo veía.
                          */}
                          {gobFor === c.id ? 'Cerrar' : 'Agregar gobelete'}
                        </button>
                        <button
                          onClick={() => call('DELETE', `/genetics/cryo/canisters/${c.id}`)}
                          className="h-7 rounded-md border border-strong bg-surface px-2 text-label text-danger hover:bg-brand-soft"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>

                    {gobFor === c.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          value={gobCode}
                          onChange={(e) => setGobCode(e.target.value)}
                          placeholder="N.º"
                          aria-label="Número de gobelete"
                          controlSize="sm"
                          className="w-24"
                        />
                        <Select
                          value={gobColor}
                          onChange={(e) => setGobColor(e.target.value)}
                          controlSize="sm"
                          aria-label="Color del gobelete"
                          className="w-32"
                        >
                          <option value="">Sin color</option>
                          {CRYO_COLORS.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          loading={busy}
                          disabled={!gobCode.trim()}
                          onClick={() =>
                            call('POST', `/genetics/cryo/canisters/${c.id}/goblets`, { code: gobCode, color: gobColor }, () => {
                              setGobCode('');
                            })
                          }
                        >
                          Agregar
                        </Button>
                      </div>
                    )}

                    {c.goblets.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {c.goblets.map((g) => (
                          <li
                            key={g.id}
                            className="flex items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-caption"
                            // La etiqueta completa sale de la regla compartida del dominio: es el mismo
                            // texto que va a usar la lista de retiro y el móvil.
                            title={cryoLocationLabel({
                              tank_code: selected.code,
                              canister_code: c.code,
                              canister_color: c.color,
                              goblet_code: g.code,
                            })}
                          >
                            <ColorDot color={g.color} />
                            {g.code}
                            <button
                              onClick={() => call('DELETE', `/genetics/cryo/goblets/${g.id}`)}
                              aria-label={`Quitar gobelete ${g.code}`}
                              className="text-ink-3 hover:text-danger"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
