'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import { login, readErrorTitle } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Country {
  code: string;
  name: string;
}

export default function RegisterPage() {
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [countriesError, setCountriesError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Fallback: cuenta creada pero el auto-login falló (no reintentar el registro)
  const [created, setCreated] = useState<{ email: string } | null>(null);

  // Países desde el backend — sin lista local ni valores de respaldo (P1.3.2/G).
  const loadCountries = useCallback(async () => {
    setCountriesError(false);
    setCountries(null);
    try {
      const res = await fetch(`${API_URL}/catalogs/countries`);
      if (!res.ok) throw new Error();
      setCountries((await res.json()) as Country[]);
    } catch {
      setCountriesError(true);
    }
  }, []);
  useEffect(() => {
    loadCountries();
  }, [loadCountries]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !countries) return; // sin países no se envía
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email')).trim().toLowerCase();
    const password = String(fd.get('password'));
    const payload = {
      email,
      password,
      full_name: String(fd.get('full_name')).trim(),
      organization_name: String(fd.get('organization_name')).trim(),
      farm_name: String(fd.get('farm_name')).trim(),
      country_code: String(fd.get('country_code')),
    };

    let res: Response;
    try {
      res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('No se pudo conectar con el servidor. Reintentá.');
      setBusy(false);
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(readErrorTitle(body, 'No se pudo crear la cuenta'));
      setBusy(false);
      return;
    }

    // Cuenta creada → auto-login con las mismas credenciales
    const auto = await login(email, password);
    if (auto.ok) {
      window.location.href = '/';
      return;
    }
    // Auto-login falló: NO repetir el registro; ofrecer ir al login
    setCreated({ email });
    setBusy(false);
  }

  // ── Fallback: cuenta creada, auto-login falló ─────────────────────────
  if (created) {
    return (
      <Shell>
        <div role="status" className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 text-center shadow-[var(--shadow-1)]">
          <h2 className="text-subheading font-semibold">Tu cuenta fue creada</h2>
          <p className="text-body text-ink-2">
            No pudimos iniciar tu sesión automáticamente. Ingresá con tu email y contraseña para continuar.
          </p>
          <Link
            href={`/login?email=${encodeURIComponent(created.email)}`}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-brand text-input font-medium text-white hover:opacity-90"
          >
            Iniciar sesión
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <Field label="Nombre completo" htmlFor="full_name">
          <Input id="full_name" name="full_name" type="text" required autoFocus autoComplete="name" placeholder="Ana Ruiz" controlSize="lg" className="placeholder:text-ink-3" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="tu@email.com" controlSize="lg" className="placeholder:text-ink-3" />
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
        <Field label="Organización" htmlFor="organization_name">
          <Input id="organization_name" name="organization_name" type="text" required autoComplete="organization" placeholder="Finca Verde" controlSize="lg" className="placeholder:text-ink-3" />
        </Field>
        <Field label="Finca" htmlFor="farm_name">
          <Input id="farm_name" name="farm_name" type="text" required placeholder="La Primera" controlSize="lg" className="placeholder:text-ink-3" />
        </Field>
        <Field label="País" htmlFor="country_code">
          {countries ? (
            <Select id="country_code" name="country_code" required defaultValue="" controlSize="lg">
              <option value="" disabled>
                Elegí un país…
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : countriesError ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-strong bg-surface px-3 py-2 text-body text-danger">
              <span>No se pudieron cargar los países.</span>
              <button type="button" onClick={loadCountries} className="font-medium text-brand hover:underline">
                Reintentar
              </button>
            </div>
          ) : (
            <p className="text-body text-ink-3">Cargando países…</p>
          )}
        </Field>

        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy} disabled={!countries}>
          {busy ? 'Creando cuenta…' : 'Crear cuenta'}
        </Button>
        <p className="text-center text-label text-ink-3">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas py-10">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white">C</div>
          <h1 className="text-xl font-semibold">Crear tu cuenta</h1>
          <p className="mt-1 text-body text-ink-3">Empezá a gestionar tu finca en minutos</p>
        </div>
        {children}
      </div>
    </div>
  );
}
