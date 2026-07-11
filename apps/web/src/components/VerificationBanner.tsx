'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { postPublic } from '@/lib/auth';
import { Button } from '@/components/Button';

type Phase = 'idle' | 'checking' | 'resending' | 'resent' | 'error';

/**
 * Banner suave de email pendiente (P1.3.5). Verificación soft (ADR-0011): informa,
 * no bloquea. Estado inicial desde /auth/me.email_verified (prop del server); se
 * revalida contra /auth/me al recuperar foco, al volver a visible y con "Ya
 * verifiqué". Sin polling, sin decodificar el token, sin store global. Aislado como
 * Client Component para no volver cliente todo el dashboard.
 */
export function VerificationBanner({ initialVerified, email }: { initialVerified: boolean; email?: string }) {
  const [verified, setVerified] = useState(initialVerified);
  const [phase, setPhase] = useState<Phase>('idle');
  const inFlight = useRef(false); // dedupe focus + visibilitychange seguidos

  const revalidate = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('checking');
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
      // auth existente (middleware/redirect) actúa en la próxima navegación.
      setPhase('idle');
    } catch {
      setPhase('error'); // error de red recuperable: no rompe el dashboard
    } finally {
      inFlight.current = false;
    }
  }, []);

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
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border-l-[3px] border-warning bg-sunken px-4 py-3">
      <Mail size={16} className="shrink-0 text-warning" strokeWidth={1.75} />
      <div className="min-w-0 flex-1 text-body">
        <span className="font-medium">Verificá tu email.</span>{' '}
        <span className="text-ink-3">
          Te enviamos un enlace{email ? ` a ${email}` : ''}. Podés seguir usando Cowinance mientras tanto.
        </span>
        {phase === 'resent' && (
          <span role="status" className="mt-1 block text-label text-ink-2">
            Te enviamos un nuevo enlace de verificación. Revisá tu correo.
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
        <Button size="sm" onClick={revalidate} loading={phase === 'checking'}>
          {phase === 'checking' ? 'Verificando…' : 'Ya verifiqué'}
        </Button>
      </div>
    </div>
  );
}
