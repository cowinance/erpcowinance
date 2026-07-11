'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, PrimaryLink } from '@/components/AuthShell';
import { postPublic, clearSession } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';

type State = 'form' | 'sending' | 'success' | 'missing' | 'invalid' | 'unavailable';

export default function ResetPasswordPage() {
  const [state, setState] = useState<State>('form');
  const [error, setError] = useState('');
  const tokenRef = useRef(''); // el token vive solo aquí: nunca en UI, cookies ni storage

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token.trim()) return setState('missing');
    tokenRef.current = token;
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending') return;
    setError('');
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password'));
    const confirm = String(fd.get('confirm'));
    // Coincidencia: validación de UX. La política de contraseña la impone el backend.
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setState('sending');
    const res = await postPublic('/reset-password', { token: tokenRef.current, new_password: password });
    if (res.ok) {
      clearSession(); // el backend revocó todas las sesiones; limpiamos la local
      return setState('success');
    }
    if (res.kind === 'network') {
      setState('form');
      setError('No se pudo conectar con el servidor. Reintentá.');
      return;
    }
    // Error HTTP: ramificamos por el code estructurado del backend.
    if (res.code === 'identity.invalid_token' || res.code === 'identity.missing_token') {
      return setState('invalid');
    }
    setState('form');
    setError(res.title ?? 'No se pudo restablecer la contraseña.');
  }

  if (state === 'success') {
    return (
      <AuthShell title="Contraseña actualizada">
        <div role="status" className="space-y-4">
          <p className="text-center text-body text-ink-2">
            Tu contraseña se restableció. Iniciá sesión con la nueva contraseña.
          </p>
          <PrimaryLink href="/login">Ir a iniciar sesión</PrimaryLink>
        </div>
      </AuthShell>
    );
  }

  if (state === 'missing' || state === 'invalid') {
    return (
      <AuthShell title="Enlace no válido">
        <div className="space-y-4">
          <p role="alert" className="text-center text-body text-ink-2">
            {state === 'missing'
              ? 'Este enlace no incluye un código de restablecimiento.'
              : 'El enlace de restablecimiento no es válido, expiró o ya se usó.'}
          </p>
          <PrimaryLink href="/forgot-password">Solicitar un enlace nuevo</PrimaryLink>
          <p className="text-center text-label text-ink-3">
            <Link href="/login" className="font-medium text-brand hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const busy = state === 'sending';
  return (
    <AuthShell title="Nueva contraseña" subtitle="Elegí una contraseña para tu cuenta">
      <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <Field label="Nueva contraseña" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            placeholder="Al menos 8 caracteres"
            controlSize="lg"
            className="placeholder:text-ink-3"
          />
        </Field>
        <Field label="Repetir contraseña" htmlFor="confirm">
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Repetí la contraseña"
            controlSize="lg"
            className="placeholder:text-ink-3"
          />
        </Field>
        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </AuthShell>
  );
}
