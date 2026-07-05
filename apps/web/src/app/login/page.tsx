'use client';

import { useState } from 'react';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from '@/lib/api';

const inputCls =
  'h-10 w-full rounded-md border border-strong bg-surface px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand placeholder:text-ink-3';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message?.title ?? 'Credenciales inválidas');
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${ACCESS_COOKIE}=${encodeURIComponent(body.access_token)}; path=/; max-age=${body.expires_in}; SameSite=Lax${secure}`;
      document.cookie = `${REFRESH_COOKIE}=${encodeURIComponent(body.refresh_token)}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax${secure}`;
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold">Cowinance</h1>
          <p className="mt-1 text-[13px] text-ink-3">El sistema operativo de tu finca</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Email</span>
            <input name="email" type="email" required autoFocus placeholder="tu@email.com" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Contraseña</span>
            <input name="password" type="password" required placeholder="••••••••" className={inputCls} />
          </label>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded-md bg-brand text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
          <p className="text-center text-[11px] text-ink-3">
            Demo: cowinance@gmail.com / cowinance · maria@elombu.com / ombu1234
          </p>
        </form>
      </div>
    </div>
  );
}
