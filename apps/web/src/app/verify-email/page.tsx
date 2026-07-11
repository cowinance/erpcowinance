'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, PrimaryLink, inputCls } from '@/components/AuthShell';
import { postPublic, hasSession } from '@/lib/auth';
import { Button } from '@/components/Button';

type State = 'verifying' | 'success' | 'missing' | 'invalid' | 'unavailable';

export default function VerifyEmailPage() {
  const [state, setState] = useState<State>('verifying');
  const ran = useRef(false); // una sola verificación por interacción (token single-use)

  const verify = useCallback(async (token: string) => {
    const res = await postPublic('/verify-email', { token });
    if (res.ok) return setState('success');
    setState(res.kind === 'network' ? 'unavailable' : 'invalid');
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // El token vive solo en esta variable local: nunca en estado, UI ni logs.
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token.trim()) return setState('missing');
    verify(token);
  }, [verify]);

  if (state === 'verifying') {
    return (
      <AuthShell title="Verificando tu email" subtitle="Un momento…">
        <p role="status" className="text-center text-body text-ink-2">
          Estamos confirmando tu cuenta.
        </p>
      </AuthShell>
    );
  }

  if (state === 'success') {
    return (
      <AuthShell title="Email verificado" subtitle="Tu cuenta quedó confirmada.">
        <div role="status" className="space-y-3">
          <p className="text-center text-body text-ink-2">Ya podés seguir usando Cowinance.</p>
          {hasSession() ? <PrimaryLink href="/">Ir al panel</PrimaryLink> : <PrimaryLink href="/login">Ir a iniciar sesión</PrimaryLink>}
        </div>
      </AuthShell>
    );
  }

  // 'missing' | 'invalid' | 'unavailable'
  const title = state === 'unavailable' ? 'No se pudo verificar' : 'Enlace no válido';
  const message =
    state === 'unavailable'
      ? 'No pudimos conectar con el servidor. Probá de nuevo en unos minutos.'
      : state === 'missing'
        ? 'Este enlace no incluye un código de verificación. Pedí uno nuevo con tu email.'
        : 'El enlace de verificación no es válido, expiró o ya se usó. Pedí uno nuevo con tu email.';

  return (
    <AuthShell title={title}>
      <div className="space-y-4">
        <p role="alert" className="text-center text-body text-ink-2">
          {message}
        </p>
        <ResendVerification />
        <p className="text-center text-label text-ink-3">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

/** Reenvío de verificación (POST /resend-verification). Público, anti-enumeración:
 *  el mensaje de confirmación es el mismo exista o no la cuenta. */
function ResendVerification() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await postPublic('/resend-verification', { email: String(fd.get('email')).trim().toLowerCase() });
    setBusy(false);
    if (!res.ok && res.kind === 'network') {
      setError('No se pudo conectar con el servidor. Reintentá.');
      return;
    }
    setSent(true); // anti-enum: no interpretamos la respuesta
  }

  if (sent) {
    return (
      <p role="status" className="rounded-md border border-subtle bg-sunken px-3 py-2 text-center text-body text-ink-2">
        Si el email corresponde a una cuenta sin verificar, te enviamos un nuevo enlace.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-label font-medium text-ink-2">Reenviar verificación a tu email</span>
        <input name="email" type="email" required autoFocus autoComplete="email" placeholder="tu@email.com" className={inputCls} />
      </label>
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth loading={busy}>
        {busy ? 'Enviando…' : 'Reenviar verificación'}
      </Button>
    </form>
  );
}
