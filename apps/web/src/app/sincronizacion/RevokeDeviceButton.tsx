'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';

/**
 * Da de baja un dispositivo y libera su lugar del plan.
 *
 * Confirmación en dos toques con reversión a los 3 s, igual que `ResolveButton`: es destructivo
 * —ese teléfono deja de sincronizar en el acto— pero recuperable volviendo a entrar desde el
 * dispositivo, así que no amerita un diálogo modal.
 *
 * El error se MUESTRA en vez de tragarse: el motivo típico es que no sos dueño ni administrador y
 * el dispositivo es de otra persona, y sin el mensaje el botón parecería roto.
 */
export function RevokeDeviceButton({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function revoke() {
    if (!confirming) {
      setConfirming(true);
      setError('');
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/sync/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo dar de baja.');
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-label text-danger">
          {error}
        </span>
      )}
      <button
        onClick={revoke}
        disabled={saving}
        aria-label={`Dar de baja ${deviceName}`}
        className={`h-7 shrink-0 rounded-md border px-3 text-label font-medium transition-colors ${
          confirming ? 'border-danger bg-danger/10 text-danger' : 'border-strong bg-surface text-ink-2 hover:bg-sunken'
        } disabled:opacity-50`}
      >
        {saving ? 'Dando de baja…' : confirming ? '¿Confirmar?' : 'Dar de baja'}
      </button>
    </span>
  );
}
