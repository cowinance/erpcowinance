'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Member {
  user_id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  role: string;
  farm_name: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  farm_name: string | null;
  expires_at: string;
  expired: boolean;
  invited_by: string | null;
}

/**
 * Qué hace cada rol, en la pantalla donde se elige.
 *
 * El texto va acá y no en un tooltip porque elegir mal el rol es el error caro de esta pantalla:
 * se descubre cuando alguien ve algo que no debía. La matriz completa vive en el backend
 * (`common/permissions/matrix.ts`); esto es su resumen para quien invita.
 */
const ROLES: { code: string; label: string; ayuda: string }[] = [
  { code: 'admin', label: 'Administrador', ayuda: 'Todo, menos la suscripción. Puede invitar gente.' },
  { code: 'veterinarian', label: 'Veterinario', ayuda: 'Sanidad, laboratorio y reproducción. No ve plata.' },
  { code: 'foreman', label: 'Capataz', ayuda: 'El día a día del campo. Aplica lo sanitario, no lo receta.' },
  { code: 'worker', label: 'Operario', ayuda: 'Captura en el corral desde el móvil. No consulta ni configura.' },
  { code: 'accountant', label: 'Contador', ayuda: 'Finanzas e impuestos. No entra a la ficha de un animal.' },
];

const ROL_ES: Record<string, string> = {
  owner: 'Propietario',
  ...Object.fromEntries(ROLES.map((r) => [r.code, r.label])),
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function UsuariosView({ members, invitations }: { members: Member[]; invitations: Invitation[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [rol, setRol] = useState('veterinarian');

  async function call(method: string, path: string, data?: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError('');
    setAviso('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo completar la acción.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invitar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get('email')).trim();
    const ok = await call('POST', '/invitations', { email, role: String(fd.get('role')) });
    if (ok) {
      form.reset();
      setRol('veterinarian');
      setAviso(`Le mandamos la invitación a ${email}. Vence en 7 días.`);
    }
  }

  const ayudaDelRol = ROLES.find((r) => r.code === rol)?.ayuda ?? '';

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-label text-danger">{error}</p>}
      {aviso && <p role="status" className="text-label text-brand">{aviso}</p>}

      <Card>
        <CardTitle>Invitar a alguien</CardTitle>
        <form onSubmit={invitar} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" required placeholder="veterinario@ejemplo.com" className="placeholder:text-ink-3" />
            </Field>
            <Field label="Rol" htmlFor="role">
              <Select id="role" name="role" value={rol} onChange={(e) => setRol(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={busy}>Enviar invitación</Button>
          </div>
          <p className="text-label text-ink-3">{ayudaDelRol}</p>
        </form>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardTitle>Invitaciones pendientes</CardTitle>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-subtle text-label text-ink-3">
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Rol</th>
                  <th className="py-2 text-left font-medium">Vence</th>
                  <th className="py-2 text-left font-medium">Invitó</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id} className="border-b border-subtle last:border-0">
                    <td className="py-2">{i.email}</td>
                    <td className="py-2">{ROL_ES[i.role] ?? i.role}</td>
                    <td className="py-2">
                      {i.expired ? <span className="font-medium text-danger">Vencida</span> : fecha(i.expires_at)}
                    </td>
                    <td className="py-2 text-ink-3">{i.invited_by ?? '—'}</td>
                    <td className="py-2 text-right">
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('DELETE', `/invitations/${i.id}`)}>
                        Cancelar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Con acceso</CardTitle>
        {members.length === 0 ? (
          <EmptyState title="Todavía no hay nadie más" body="Invitá a tu veterinario o a tu capataz con el formulario de arriba." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-subtle text-label text-ink-3">
                  <th className="py-2 text-left font-medium">Nombre</th>
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Rol</th>
                  <th className="py-2 text-left font-medium">Último ingreso</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b border-subtle last:border-0">
                    <td className="py-2">{m.full_name}</td>
                    <td className="py-2 text-ink-2">{m.email}</td>
                    <td className="py-2">{ROL_ES[m.role] ?? m.role}</td>
                    <td className="py-2 text-ink-3">{fecha(m.last_login_at)}</td>
                    <td className="py-2 text-right">
                      {/*
                        El propietario no muestra botón: el backend rechaza quitarle el acceso al
                        último, y a los demás solo el dueño. Ofrecer un botón que casi siempre
                        termina en un error explicaría el permiso DESPUÉS de intentarlo.
                      */}
                      {m.role !== 'owner' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`¿Quitarle el acceso a ${m.full_name}?`)) void call('DELETE', `/members/${m.user_id}`);
                          }}
                        >
                          Quitar acceso
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
