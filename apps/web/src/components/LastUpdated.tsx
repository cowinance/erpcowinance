'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { describeAge, minutesSince, STALE_MINUTES } from '@/lib/age';

/**
 * Cuánto hace que se armó lo que se está mirando, y un botón para volver a pedirlo.
 *
 * **Por qué hace falta.** El Inicio se renderiza en el servidor y después queda quieto. Una pantalla
 * abierta desde la mañana —lo normal en la oficina de una finca, o en un celular que no se cerró—
 * sigue mostrando los números de la mañana sin nada que lo diga. Sobre una agenda del día eso
 * engaña: «Tareas vencidas 0» a las tres de la tarde puede ser el 0 de las siete.
 *
 * **Por qué es un componente de cliente.** El texto tiene que SEGUIR CONTANDO. Calcularlo en el
 * servidor daría «hace un momento» congelado para siempre, que es la misma mentira de antes con
 * mejor letra. Acá se recalcula cada 30 segundos mientras la pestaña está abierta.
 *
 * **Por qué no se refresca solo.** Recargar sin que nadie lo pida mueve la pantalla debajo del dedo
 * —justo cuando el productor va a tocar «Completar»— y en el campo se paga en datos. Se avisa y se
 * deja el botón; pasados los cinco minutos el aviso se hace notar, porque a esa altura el riesgo
 * dejó de ser molestar y pasó a ser creerle a un número viejo.
 */
export function LastUpdated({ at }: { at?: string | null }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [minutos, setMinutos] = useState<number | null>(null);

  useEffect(() => {
    if (!at) return;
    // La regla —incluido el reloj atrasado— vive en `lib/age`, probada aparte.
    const calcular = () => setMinutos(minutesSince(at, Date.now()));
    calcular();
    const t = setInterval(calcular, 30_000);
    return () => clearInterval(t);
  }, [at]);

  if (!at || minutos === null) return null;

  const viejo = minutos >= STALE_MINUTES;
  const texto = describeAge(minutos);

  return (
    <span className={`inline-flex items-center gap-1.5 text-label ${viejo ? 'text-warning' : 'text-ink-3'}`}>
      {texto}
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pendiente}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-sunken disabled:opacity-50"
        aria-label="Actualizar los datos de la pantalla"
      >
        <RefreshCw size={12} strokeWidth={2} className={pendiente ? 'animate-spin' : ''} />
        {pendiente ? 'Actualizando' : 'Actualizar'}
      </button>
    </span>
  );
}
