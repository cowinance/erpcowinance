/**
 * Estado de sincronización (móvil): qué está pendiente de subir (detalle
 * legible de la cola local, visible offline) y los conflictos del servidor
 * en revisión (requieren conexión) con resolución de un toque.
 * "El usuario siempre sabe qué está pendiente" — doc Arquitectura §12.3.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, ServerConflict } from '@/sync/SyncContext';
import { Button, Card } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';

const CONFLICT_LABEL: Record<string, string> = {
  semantic: 'Semántico',
  duplicate: 'Duplicado',
  concurrent_update: 'Edición concurrente',
};

function ConflictRow({ c, onResolved }: { c: ServerConflict; onResolved: () => void }) {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setBusy(true);
    const ok = await sync.resolveConflict(c.id);
    setBusy(false);
    if (ok) onResolved();
  }

  return (
    <View style={styles.conflictRow}>
      <Ionicons name="alert-circle-outline" size={18} color={T.warning} style={{ marginTop: T.space['0.5'] }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: T.type.body, fontWeight: '600', color: T.ink }}>
          {CONFLICT_LABEL[c.conflict_type] ?? c.conflict_type}
          {c.tag ? ` · caravana ${c.tag}` : ''}
        </Text>
        <Text style={{ fontSize: T.type.label, color: T.ink2, marginTop: T.space['0.5'] }}>{c.detail}</Text>
      </View>
      <Pressable onPress={resolve} disabled={busy} style={[styles.resolveBtn, confirming && { borderColor: T.warning }]}>
        <Text style={{ fontSize: T.type.caption, fontWeight: '600', color: confirming ? T.warning : T.ink2 }}>
          {busy ? '…' : confirming ? '¿Confirmar?' : 'Resolver'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function SyncScreen() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [conflicts, setConflicts] = useState<ServerConflict[] | null>(null);
  const [conflictsError, setConflictsError] = useState('');
  const pending = sync.pendingDetail();

  const load = useCallback(async () => {
    setConflictsError('');
    const res = await sync.fetchConflicts();
    if (Array.isArray(res)) setConflicts(res.filter((c) => !c.resolved_at));
    else {
      setConflicts(null);
      setConflictsError(res.error);
    }
  }, [sync]);

  useEffect(() => {
    load();
  }, [load, sync.lastSyncAt, sync.offlineSim]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1'] }}>
          <Ionicons name="chevron-back" size={16} color={T.ink2} />
          <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Volver</Text>
        </Pressable>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Sincronización</Text>

        <Card>
          <Text style={styles.cardTitle}>Pendiente de subir ({pending.length})</Text>
          {pending.length === 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1.5'], paddingVertical: T.space['1.5'] }}>
              <Ionicons name="checkmark-circle" size={16} color={T.success} />
              <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Todo al día — nada en cola.</Text>
            </View>
          ) : (
            pending.map((p, i) => (
              <View key={i} style={styles.pendingRow}>
                <Ionicons name="cloud-upload-outline" size={15} color={T.warning} />
                <Text style={{ fontSize: T.type.body, color: T.ink, flex: 1 }}>{p.summary}</Text>
                {p.tag && <Text style={{ fontFamily: 'monospace', fontSize: 12, color: T.ink2 }}>{p.tag}</Text>}
              </View>
            ))
          )}
          {pending.length > 0 && (
            <View style={{ marginTop: T.space['2.5'] }}>
              <Button label={sync.syncing ? 'Sincronizando…' : 'Subir ahora'} onPress={() => sync.syncNow()} disabled={sync.syncing || sync.offlineSim} />
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Conflictos en revisión {conflicts ? `(${conflicts.length})` : ''}</Text>
          <Text style={{ fontSize: T.type.caption, color: T.ink3, marginBottom: T.space['2'] }}>
            El sistema converge solo; lo irresoluble queda acá — nunca se descartan datos en silencio.
          </Text>
          {conflictsError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1.5'], paddingVertical: T.space['1.5'] }}>
              <Ionicons name="cloud-offline-outline" size={16} color={T.ink3} />
              <Text style={{ fontSize: T.type.body, color: T.ink3, flex: 1 }}>{conflictsError}</Text>
            </View>
          ) : conflicts === null ? (
            <Text style={{ fontSize: T.type.body, color: T.ink3, paddingVertical: T.space['1.5'] }}>Cargando…</Text>
          ) : conflicts.length === 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1.5'], paddingVertical: T.space['1.5'] }}>
              <Ionicons name="checkmark-circle" size={16} color={T.success} />
              <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Sin conflictos abiertos.</Text>
            </View>
          ) : (
            conflicts.map((c) => <ConflictRow key={c.id} c={c} onResolved={load} />)
          )}
        </Card>

        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>
          Último sync: {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('es-AR') : 'nunca'} · {sync.storageEngine}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  cardTitle: { fontSize: T.type.subheading, fontWeight: '600', color: T.ink, marginBottom: T.space['2'] },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2'],
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
  },
  conflictRow: {
    flexDirection: 'row',
    gap: T.space['2'],
    paddingVertical: T.space['2'],
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
  },
  resolveBtn: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['2.5'],
    paddingVertical: T.space['1.5'],
    alignSelf: 'center',
  },
});
