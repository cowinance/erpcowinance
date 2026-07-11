'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell, inputCls } from '@/components/AuthShell';
import { postPublic } from '@/lib/auth';
import { Button } from '@/components/Button';

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await postPublic('/forgot-password', { email: String(fd.get('email')).trim().toLowerCase() });
    setBusy(false);
    // Solo un fallo de red merece reintento; un error HTTP no debe revelar nada.
    if (!res.ok && res.kind === 'network') {
      setError('No se pudo conectar con el servidor. Reintentá.');
      return;
    }
    setSent(true); // anti-enum: mismo mensaje exista o no la cuenta
  }

  if (sent) {
    return (
      <AuthShell title="Revisá tu correo">
        <div role="status" className="space-y-4">
          <p className="text-center text-body text-ink-2">
            Si existe una cuenta con ese email, te enviamos un enlace para restablecer tu contraseña.
          </p>
          <p className="text-center text-label text-ink-3">
            <Link href="/login" className="font-medium text-brand hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Restablecer contraseña" subtitle="Te enviaremos un enlace a tu email">
      <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <label className="block">
          <span className="mb-1 block text-label font-medium text-ink-2">Email</span>
          <input name="email" type="email" required autoFocus autoComplete="email" placeholder="tu@email.com" className={inputCls} />
        </label>
        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? 'Enviando…' : 'Enviar enlace'}
        </Button>
        <p className="text-center text-label text-ink-3">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
