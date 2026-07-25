'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { postPublic } from '@/lib/auth';
import { Button } from '@/components/Button';

type Phase = 'idle' | 'checking' | 'unverified' | 'resending' | 'resent' | 'error';

/**
 * Banner suave de email pendiente (P1.3.5). Verificación soft (ADR-0011): informa,
 * no bloquea. Estado inicial desde /auth/me.email_verified (prop del server); se
 * revalida contra /auth/me al recuperar foco, al volver a visible y con "Ya
 * verifiqué". Sin polling, sin decodificar el token, sin store global. Aislado como
 * Client Component para no volver cliente todo el dashboard.
 *
 * Los dos botones SIEMPRE hicieron lo suyo —revalidar y reenviar— pero no lo decían:
 * «Ya verifiqué» sobre una cuenta sin verificar volvía a `idle`, o sea a la pantalla
 * idéntica a la de antes de tocarlo, y «Reenviar» confirmaba un envío que en un
 * servidor sin SMTP nunca sale. Un botón que responde lo mismo que si no existiera se
 * lee como roto. Por eso ahora hay un estado explícito para «sigue sin verificar» y un
 * aviso cuando el servidor no está configurado para mandar correo: sin eso, el usuario
 * espera indefinidamente un email que nadie va a enviar.
 */
export function VerificationBanner({
  initialVerified,
  email,
  emailDelivery,
}: {
  initialVerified: boolean;
  email?: string;
  /** 'log' = este servidor NO envía correo (imprime el mensaje). Viene de /auth/me. */
  emailDelivery?: 'log' | 'enabled';
}) {
  const [verified, setVerified] = useState(initialVerified);
  const [phase, setPhase] = useState<Phase>('idle');
  const inFlight = useRef(false); // dedupe focus + visibilitychange seguidos
  const puedeEnviar = emailDelivery !== 'log';

  const revalidate = useCallback(
    async (manual = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (manual) setPhase('checking');
      try {
        const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders(), cache: 'no-store' });
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me?.email_verified) {
            setVerified(true);
            return;
          }
        }
        // Sin verificar aún, o 401: no inventamos un segundo refresh — el flujo de
        // auth existente (middleware/redirect) actúa en la próxima navegación. Si el
        // chequeo lo pidió la persona, se lo decimos; si fue el foco de la ventana, no
        // se interrumpe con un aviso que no pidió.
        setPhase(manual ? 'unverified' : 'idle');
      } catch {
        setPhase('error'); // error de red recuperable: no rompe el dashboard
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    if (verified) return;
    const onFocus = () => revalidate();
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [verified, revalidate]);

  async function resend() {
    if (phase === 'resending' || !email) return;
    setPhase('resending');
    const res = await postPublic('/resend-verification', { email });
    setPhase(!res.ok && res.kind === 'network' ? 'error' : 'resent');
  }

  if (verified) return null;

  return (
    // En móvil se apila. Antes era una sola fila con `flex-wrap`, y no alcanzaba: los botones son
    // `shrink-0` (~270 px entre los dos) y el texto tiene `min-w-0`, así que en vez de empujarlos a
    // la línea de abajo el texto se APLASTABA hasta ~40 px y salía una palabra por línea, ocupando
    // la pantalla entera del teléfono. `flex-wrap` no lo evita: solo baja un elemento cuando no
    // puede encogerse más, y este podía.
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border-l-[3px] border-warning bg-sunken px-4 py-3 max-sm:flex-col max-sm:items-start">
      <Mail size={16} className="shrink-0 text-warning" strokeWidth={1.75} />
      {/* `break-words`: los tokens de configuración (EMAIL_PROVIDER=smtp) no tienen dónde cortar y
          desbordan el ancho del teléfono. */}
      <div className="min-w-0 flex-1 text-body break-words">
        <span className="font-medium">Verificá tu email.</span>{' '}
        <span className="text-ink-3">
          {puedeEnviar
            ? `Te enviamos un enlace${email ? ` a ${email}` : ''}. Podés seguir usando Cowinance mientras tanto.`
            : 'Podés seguir usando Cowinance: la verificación no bloquea nada.'}
        </span>
        {!puedeEnviar && (
          <span role="alert" className="mt-1 block text-label text-danger">
            Este servidor no está configurado para enviar correo, así que el enlace no va a llegar por
            más que lo reenvíes. Configurá <code>EMAIL_PROVIDER=smtp</code> (con <code>SMTP_HOST</code>,{' '}
            <code>SMTP_FROM</code>) y <code>APP_BASE_URL</code> con tu dominio, y reiniciá la API.
          </span>
        )}
        {phase === 'unverified' && (
          <span role="status" className="mt-1 block text-label text-ink-2">
            {puedeEnviar
              ? 'Todavía figura sin verificar. Abrí el enlace del correo y volvé a tocar «Ya verifiqué».'
              : 'Todavía figura sin verificar, y no puede verificarse hasta que el servidor pueda enviar el correo.'}
          </span>
        )}
        {phase === 'resent' && (
          <span role="status" className="mt-1 block text-label text-ink-2">
            {puedeEnviar
              ? 'Te enviamos un nuevo enlace de verificación. Revisá tu correo.'
              : 'Se generó un enlace nuevo, pero el servidor no lo envía: quedó en el log de la API.'}
          </span>
        )}
        {phase === 'error' && (
          <span role="alert" className="mt-1 block text-label text-danger">
            No se pudo conectar. Probá de nuevo.
          </span>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={resend}
          disabled={phase === 'resending'}
          className="h-8 rounded-md border border-strong bg-surface px-3 text-label font-medium hover:bg-brand-soft disabled:opacity-50"
        >
          {phase === 'resending' ? 'Enviando…' : 'Reenviar email'}
        </button>
        <Button size="sm" onClick={() => revalidate(true)} loading={phase === 'checking'}>
          {phase === 'checking' ? 'Verificando…' : 'Ya verifiqué'}
        </Button>
      </div>
    </div>
  );
}
