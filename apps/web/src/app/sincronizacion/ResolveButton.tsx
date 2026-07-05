'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';

export function ResolveButton({ conflictId }: { conflictId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function resolve() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setSaving(true);
    await fetch(`${API_URL}/sync/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ conflict_id: conflictId, resolution: 'manual' }),
    });
    router.refresh();
  }

  return (
    <button
      onClick={resolve}
      disabled={saving}
      className={`h-7 shrink-0 rounded-md border px-3 text-[12px] font-medium transition-colors ${
        confirming
          ? 'border-warning bg-warning/10 text-warning'
          : 'border-strong bg-surface text-ink-2 hover:bg-sunken'
      } disabled:opacity-50`}
    >
      {saving ? 'Guardando…' : confirming ? '¿Confirmar?' : 'Marcar resuelto'}
    </button>
  );
}
