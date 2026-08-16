'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

export interface OrgOption {
  tenant_id: string;
  name: string;
  role: string;
}

const ROL_ES: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  veterinarian: 'Veterinario',
  foreman: 'Capataz',
  worker: 'Operario',
  accountant: 'Contador',
};

/**
 * Cabecera de contexto de la barra lateral: organización, finca, y —si corresponde— cambiar.
 *
 * **Con una sola organización no es un menú.** Ese es el caso de casi todo el mundo, y un menú que
 * se abre para mostrar la única opción posible es peor que no tenerlo: promete algo y no cumple.
 * Con una sola queda el mismo botón inerte que había antes, sin la flecha.
 *
 * El cambio recarga la página entera a propósito. No es pereza: el token nuevo trae otro tenant y
 * otro rol, así que TODO lo que hay en pantalla —los datos, los badges, hasta qué secciones del
 * menú se ven— corresponde a la finca anterior. Refrescar por partes dejaría, aunque sea un
 * instante, media pantalla de una finca y media de la otra.
 */
export function OrgSwitcher({
  organizations,
  farmName,
  orgName,
}: {
  organizations: OrgOption[];
  farmName?: string;
  orgName?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const caja = useRef<HTMLDivElement>(null);

  const farm = farmName ?? 'Cowinance';
  const initials =
    farm
      .split(' ')
      .filter((w) => w.length > 2)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'CW';

  // Cerrar al hacer clic afuera o con Escape: un menú que solo se cierra con su propio botón queda
  // abierto tapando la navegación cuando alguien se arrepiente a mitad de camino.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const varias = organizations.length > 1;
  const actual = organizations.find((o) => o.name === orgName);

  async function cambiar(destino: OrgOption) {
    if (cambiando) return;
    if (destino.name === orgName) return setAbierto(false);
    setCambiando(destino.tenant_id);
    setError('');
    try {
      const res = await fetch('/api/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: destino.tenant_id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? 'No se pudo cambiar de organización');
      }
      // Recarga dura, no `router.refresh()`: hay que volver a leer las cookies nuevas desde el
      // servidor y rearmar el shell entero con el rol nuevo.
      window.location.href = '/';
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cambiar de organización');
      setCambiando(null);
    }
  }

  const cabecera = (
    <>
      <div className="flex size-7 items-center justify-center rounded-md bg-brand text-label font-semibold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold">{farm}</div>
        <div className="truncate text-caption text-ink-3">{orgName ?? '—'}</div>
      </div>
      {varias && <ChevronsUpDown size={14} className="text-ink-3" />}
    </>
  );

  if (!varias)
    return (
      <button className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-brand-soft">
        {cabecera}
      </button>
    );

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-brand-soft"
      >
        {cabecera}
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute top-full left-0 z-30 mt-1 w-full min-w-[220px] overflow-hidden rounded-md border border-subtle bg-surface shadow-[var(--shadow-2)]"
        >
          <div className="border-b border-subtle px-3 py-2 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
            Cambiar de finca
          </div>
          {organizations.map((o) => {
            const esActual = o.tenant_id === actual?.tenant_id;
            return (
              <button
                key={o.tenant_id}
                role="menuitem"
                disabled={!!cambiando}
                onClick={() => cambiar(o)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-brand-soft disabled:opacity-60 ${
                  esActual ? 'bg-sunken' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium">{o.name}</div>
                  <div className="truncate text-caption text-ink-3">
                    {cambiando === o.tenant_id ? 'Entrando…' : (ROL_ES[o.role] ?? o.role)}
                  </div>
                </div>
                {esActual && <Check size={14} className="shrink-0 text-brand" />}
              </button>
            );
          })}
          {error && (
            <p role="alert" className="border-t border-subtle px-3 py-2 text-caption text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
