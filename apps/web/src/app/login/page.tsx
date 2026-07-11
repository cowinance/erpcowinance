'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { login } from '@/lib/auth';

const inputCls =
  'h-10 w-full rounded-md border border-strong bg-surface px-3 text-input outline-none focus:ring-2 focus:ring-brand placeholder:text-ink-3';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Prellenar el email si venimos del fallback de registro (/login?email=…)
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get('email');
    if (prefill) setEmail(prefill);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await login(String(fd.get('email')), String(fd.get('password')));
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    setError(res.error);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold">Cowinance</h1>
          <p className="mt-1 text-body text-ink-3">El sistema operativo de tu finca</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
          <label className="block">
            <span className="mb-1 block text-label font-medium text-ink-2">Email</span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-label font-medium text-ink-2">Contraseña</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputCls}
            />
          </label>
          {error && (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded-md bg-brand text-input font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
          <div className="flex items-center justify-between text-label">
            <Link href="/register" className="font-medium text-brand hover:underline">
              Crear cuenta
            </Link>
            <Link href="/forgot-password" className="text-ink-3 hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
