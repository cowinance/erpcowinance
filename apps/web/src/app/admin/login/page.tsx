'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { apiErrorTitle } from '@/lib/api';

/**
 * Login del panel de plataforma.
 *
 * Visualmente distinto del login de la app —fondo oscuro, sin «crear cuenta», sin recuperar
 * contraseña— porque acá no hay autoservicio: un administrador de plataforma se da de alta desde
 * la base o por variable de entorno, nunca desde una pantalla. Ofrecer «crear cuenta» sería
 * prometer algo que no existe.
 */
function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const expirada = useSearchParams().get('expirada');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(fd.get('email')), password: String(fd.get('password')) }),
      });
      if (res.ok) {
        window.location.href = '/admin';
        return;
      }
      setError(apiErrorTitle(await res.json().catch(() => null), 'Credenciales inválidas'));
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sunken px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold">Administración de plataforma</h1>
          <p className="mt-1 text-body text-ink-3">Acceso restringido al equipo de Cowinance</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
          {expirada && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-label text-ink-2">
              Tu sesión de plataforma venció. Ingresá de nuevo.
            </p>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required autoFocus autoComplete="email" controlSize="lg" />
          </Field>
          <Field label="Contraseña" htmlFor="password">
            <Input id="password" name="password" type="password" required autoComplete="current-password" controlSize="lg" />
          </Field>
          {error && (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </Button>
          <p className="text-center text-caption text-ink-3">La sesión de plataforma dura 30 minutos.</p>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  // `useSearchParams` obliga a un límite de Suspense para que la página siga siendo prerenderizable.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
