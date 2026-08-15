'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthShell, PrimaryLink } from '@/components/AuthShell';
import { postPublic } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';

interface Previa {
  email: string;
  role: string;
  role_name: string;
  organization_name: string;
  expires_at: string;
}

type State = 'loading' | 'form' | 'sending' | 'success' | 'missing' | 'invalid' | 'network';

/**
 * Aceptar una invitación: es la primera pantalla que ve alguien que todavía no tiene cuenta.
 *
 * Se previsualiza ANTES de pedir la contraseña —a qué finca, con qué rol— porque quien abre el
 * enlace no siempre lo esperaba, y pedirle una contraseña sin decirle a qué la está poniendo es
 * indistinguible de un phishing. Es el mismo motivo por el que el email dice la organización.
 *
 * El token vive solo en un ref, como en `reset-password`: nunca en el estado que se renderiza, ni
 * en storage, ni en un campo del formulario.
 */
export default function AceptarInvitacionPage() {
  const [state, setState] = useState<State>('loading');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [error, setError] = useState('');
  const tokenRef = useRef('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token.trim()) return setState('missing');
    tokenRef.current = token;
    void (async () => {
      const res = await postPublic<Previa>('/invitations/preview', { token });
      if (res.ok && res.data) {
        setPrevia(res.data);
        return setState('form');
      }
      setState(!res.ok && res.kind === 'network' ? 'network' : 'invalid');
    })();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending') return;
    setError('');
    const fd = new FormData(e.currentTarget);
    const fullName = String(fd.get('full_name')).trim();
    const password = String(fd.get('password'));
    const confirm = String(fd.get('confirm'));
    // Coincidencia: validación de UX. El largo mínimo lo impone el backend.
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setState('sending');
    const res = await postPublic('/invitations/accept', { token: tokenRef.current, password, full_name: fullName });
    if (res.ok) return setState('success');
    if (res.kind === 'network') {
      setState('form');
      setError('No se pudo conectar con el servidor. Reintentá.');
      return;
    }
    // El token pudo vencer o revocarse mientras la persona completaba el formulario: eso no es un
    // error del formulario, así que se sale de la pantalla en vez de pintar el campo de rojo.
    if (res.code === 'invitation.invalid_token' || res.code === 'invitation.ya_aceptada') return setState('invalid');
    setState('form');
    setError(res.title ?? 'No se pudo aceptar la invitación.');
  }

  if (state === 'loading') {
    return (
      <AuthShell title="Invitación">
        <p role="status" className="text-center text-body text-ink-3">
          Verificando la invitación…
        </p>
      </AuthShell>
    );
  }

  if (state === 'success') {
    return (
      <AuthShell title="Listo, ya tenés acceso">
        <div role="status" className="space-y-4">
          <p className="text-center text-body text-ink-2">
            Tu cuenta quedó creada. Iniciá sesión con {previa?.email} y la contraseña que elegiste.
          </p>
          <PrimaryLink href="/login">Ir a iniciar sesión</PrimaryLink>
        </div>
      </AuthShell>
    );
  }

  if (state === 'network') {
    return (
      <AuthShell title="No se pudo conectar">
        <div className="space-y-4">
          <p role="alert" className="text-center text-body text-ink-2">
            No pudimos verificar la invitación. Revisá tu conexión y recargá la página.
          </p>
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
              ? 'Este enlace no incluye un código de invitación.'
              : 'La invitación no es válida, venció o ya se usó. Pedile a quien te invitó que te mande una nueva.'}
          </p>
          <p className="text-center text-label text-ink-3">
            <Link href="/login" className="font-medium text-brand hover:underline">
              Ir a iniciar sesión
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const busy = state === 'sending';
  return (
    <AuthShell
      title={`Te invitaron a ${previa?.organization_name ?? 'una finca'}`}
      subtitle={`Vas a entrar como ${previa?.role_name ?? 'usuario'}`}
    >
      <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <div className="rounded-md bg-brand-soft px-3 py-2 text-label text-ink-2">
          Tu usuario va a ser <span className="font-medium text-ink-1">{previa?.email}</span>
        </div>
        <Field label="Tu nombre" htmlFor="full_name">
          <Input
            id="full_name"
            name="full_name"
            required
            autoFocus
            autoComplete="name"
            placeholder="Nombre y apellido"
            controlSize="lg"
            className="placeholder:text-ink-3"
          />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
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
          {busy ? 'Creando tu cuenta…' : 'Aceptar invitación'}
        </Button>
      </form>
    </AuthShell>
  );
}
