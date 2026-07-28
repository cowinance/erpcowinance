'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';

interface Estado {
  loaded: boolean;
  animals: number;
  lots: number;
}

/**
 * Datos de ejemplo (O-3): cargarlos y —sobre todo— sacarlos.
 *
 * Una finca recién creada está vacía, y una app vacía no muestra para qué sirve: todos los KPIs en
 * cero, ninguna agenda, ningún gráfico. Con un hato de muestra el productor puede mirar primero y
 * decidir después, en vez de tener que cargar su hato entero para poder juzgar.
 *
 * El aviso mientras están cargados NO es decorativo. Lo peor que puede pasar con datos de ejemplo
 * es que el productor se olvide de que están y empiece a trabajar encima: a partir de ahí, cada
 * número que mire —cuántos animales tiene, cuánto pesan, cuánto ganan— es mentira, y va a tardar en
 * darse cuenta. Por eso el aviso es permanente, dice cuántos son y tiene el botón de sacarlos al
 * lado; y por eso las caravanas empiezan con `EJ-`, que se ve en cualquier listado de la app.
 */
export function SampleData({ hasAnimals }: { hasAnimals: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const leer = () =>
    fetch(`${API_URL}/onboarding/sample`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setEstado)
      .catch(() => setEstado(null));

  useEffect(() => {
    void leer();
  }, []);

  async function accion(metodo: 'POST' | 'DELETE') {
    setTrabajando(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/onboarding/sample`, { method: metodo, headers: authHeaders() });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.message?.title ?? b?.title ?? `Error ${res.status}`);
      }
      await leer();
      router.refresh(); // los KPIs y los primeros pasos los calcula el servidor: hay que recargarlos
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(false);
    }
  }

  if (!estado) return null;

  if (estado.loaded)
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[10px] border border-warning/30 bg-warning/10 px-4 py-3">
        <FlaskConical size={16} className="shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">Estás viendo datos de ejemplo</p>
          <p className="text-label text-ink-3">
            {estado.animals} animales y {estado.lots} lotes de muestra, con caravanas que empiezan con{' '}
            <code className="rounded bg-sunken px-1 font-mono text-compat-11">EJ-</code>. No son tuyos: sacalos antes de
            empezar a trabajar en serio.
          </p>
          {error && <p className="mt-1 text-label text-danger">{error}</p>}
        </div>
        <Button variant="secondary" size="sm" loading={trabajando} onClick={() => accion('DELETE')}>
          {trabajando ? 'Quitando…' : 'Quitar datos de ejemplo'}
        </Button>
      </div>
    );

  // El ofrecimiento solo con el hato vacío: a una finca que ya trabaja, meterle animales inventados
  // no le sirve de nada y le complica los números.
  if (hasAnimals) return null;

  return (
    <p className="mb-5 text-label text-ink-3">
      ¿Querés ver cómo se ve la app con datos?{' '}
      <button
        type="button"
        onClick={() => accion('POST')}
        disabled={trabajando}
        className="font-medium text-brand hover:underline disabled:opacity-60"
      >
        {trabajando ? 'Cargando…' : 'Cargar un hato de ejemplo'}
      </button>{' '}
      — se quita cuando quieras, sin dejar rastro.
      {error && <span className="ml-2 text-danger">{error}</span>}
    </p>
  );
}
