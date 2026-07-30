import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/sync/SyncContext';
import { useAccount } from '@/account/AccountContext';
import { Button, Card, Kpi, SyncDot } from '@/components/ui';
import { EmptyHerd } from '@/components/EmptyHerd';
import { AgendaToday } from '@/components/AgendaToday';
import { useStyles, useTheme, type Theme } from '@/useTheme';

/**
 * Home móvil como estación OPERATIVA de campo (Home E4). Lo primero es «qué hacer ahora»:
 * atención prioritaria compacta (online, best-effort desde /dashboard/home) + agenda del día
 * (local/offline) arriba de todo, luego botones GRANDES (Manga/Tareas/Sincronizar) y el estado.
 * Evita gráficos. Offline-first: la agenda y los contadores son locales; la prioridad se oculta
 * sin conexión (no bloquea nada).
 */
interface PriorityItem { code: string; label: string; count: number; severity: string }

/**
 * El color de cada severidad, como FUNCIÓN del tema.
 *
 * Era una tabla a nivel de módulo (`{ critical: T.danger, … }`), y eso se evalúa al importar el
 * archivo: los colores quedaban grabados con la paleta clara y ningún hook podía cambiarlos. Es la
 * misma trampa que las hojas de estilo, en versión chica y más fácil de pasar por alto —el
 * typechecker la marcó solo porque `T` dejó de existir a nivel de módulo.
 */
const sevColor = (T: Theme, severity: string) =>
  ({ critical: T.danger, warning: T.warning, info: T.info })[severity];
// Destino en móvil por código (las condiciones de sanidad/repro se materializan como tareas).
const ROUTE: Record<string, string> = { no_recent_weighing: '/(tabs)/animales' };
const routeFor = (code: string) => ROUTE[code] ?? '/tareas';

export default function Home() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const account = useAccount();
  const firstName = account.name?.split(' ')[0];
  const [priority, setPriority] = useState<PriorityItem[]>([]);

  // Atención prioritaria (online, best-effort): compone /dashboard/home. Sin conexión → se oculta.
  useEffect(() => {
    if (sync.status !== 'ready') return;
    let alive = true;
    sync
      .authFetch('/dashboard/home')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && Array.isArray(d?.priority)) setPriority(d.priority); })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sync.status]);

  if (sync.status === 'boot') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: T.ink2 }}>Preparando la base local…</Text>
      </SafeAreaView>
    );
  }
  if (sync.status === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ fontSize: T.compat['16'], fontWeight: '600', color: T.ink }}>No se pudo inicializar</Text>
        <Text style={{ color: T.ink2, marginTop: T.space['1.5'], textAlign: 'center', paddingHorizontal: T.space['8'] }}>
          El primer arranque necesita la API ({sync.errorMsg}). Después, la app funciona 100% offline.
        </Text>
        <View style={{ marginTop: T.space['4'], width: 200 }}>
          <Button label="Reintentar" onPress={() => sync.resetLocal()} />
        </View>
      </SafeAreaView>
    );
  }

  const animals = sync.animals();
  const pendingTasks = sync.tasks().filter((t) => t.status === 'pending').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  async function doSync() {
    await sync.syncNow();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Text style={styles.h1}>{firstName ? `${greeting}, ${firstName}` : greeting}</Text>
            <Text style={{ fontSize: T.type.body, color: T.ink3, marginTop: T.space['0.5'] }}>{sync.farmName ?? 'Cowinance'}</Text>
          </View>
          <SyncDot pending={sync.pendingCount} />
        </View>

        {sync.offlineSim && (
          <View style={styles.offlineBanner}>
            <Text style={{ color: '#fff', fontSize: T.type.body, fontWeight: '600' }}>
              Sin conexión (simulada) — {sync.pendingCount} {sync.pendingCount === 1 ? 'registro pendiente' : 'registros pendientes'} de subir
            </Text>
          </View>
        )}

        {/* Atención prioritaria — compacta, arriba de todo (online) */}
        {priority.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] }}>
            {priority.slice(0, 6).map((p) => (
              <Pressable
                key={p.code}
                onPress={() => router.push(routeFor(p.code) as any)}
                style={[styles.priChip, { borderLeftColor: sevColor(T, p.severity) ?? T.info }]}
              >
                <Text style={[styles.priCount, { color: sevColor(T, p.severity) ?? T.ink }]}>{p.count}</Text>
                <Text style={styles.priLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Qué hacer AHORA — agenda del día, local/offline */}
        <AgendaToday />

        {/* Acción principal de campo — Manga, botón grande */}
        {animals.length === 0 ? (
          <Card>
            <EmptyHerd />
          </Card>
        ) : (
          <Pressable onPress={() => router.push('/manga')} style={styles.mangaBtn}>
            <Ionicons name="scan-outline" size={26} color="#fff" />
            <View>
              <Text style={styles.mangaTitle}>Modo manga</Text>
              <Text style={styles.mangaSub}>Pesajes y capturas offline, en menos de 3 toques</Text>
            </View>
          </Pressable>
        )}

        {/* Tareas + Sincronizar — accesos grandes */}
        <View style={{ flexDirection: 'row', gap: T.space['3'] }}>
          <Pressable onPress={() => router.push('/tareas')} style={styles.actionCard}>
            <Ionicons name="checkbox-outline" size={22} color={T.brand700} />
            <Text style={styles.actionTitle}>Tareas</Text>
            <Text style={styles.actionSub}>{pendingTasks === 0 ? 'sin pendientes' : `${pendingTasks} pendiente${pendingTasks === 1 ? '' : 's'}`}</Text>
          </Pressable>
          <Pressable onPress={doSync} disabled={sync.syncing} style={[styles.actionCard, sync.syncing && { opacity: 0.6 }]}>
            <Ionicons name="sync-outline" size={22} color={T.brand700} />
            <Text style={styles.actionTitle}>{sync.syncing ? 'Sincronizando…' : 'Sincronizar'}</Text>
            <Text style={styles.actionSub}>{sync.pendingCount ? `${sync.pendingCount} por subir` : 'todo al día'}</Text>
          </Pressable>
        </View>

        {/* Estado compacto — al final, sin gráficos */}
        <View style={{ flexDirection: 'row', gap: T.space['3'] }}>
          <Kpi label="Animales activos" value={String(animals.length)} hint="en la base local" />
          <Kpi
            label="Pendientes de subir"
            value={String(sync.pendingCount)}
            hint={sync.pendingCount ? 'esperando sincronización' : 'todo al día'}
            tone={sync.pendingCount ? 'warning' : 'success'}
          />
        </View>

        {sync.lastSyncResult ? (
          <Text style={{ fontSize: T.type.label, textAlign: 'center', color: sync.lastSyncResult.startsWith('Sync OK') ? T.success : T.warning }}>
            {sync.lastSyncResult}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.canvas },
  h1: { fontSize: T.type.title, fontWeight: '700', color: T.ink },
  offlineBanner: { backgroundColor: T.warning, borderRadius: T.radiusSm, paddingVertical: T.space['2'], paddingHorizontal: T.space['3'] },
  priChip: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderLeftWidth: 3,
    paddingVertical: T.space['2'],
    paddingHorizontal: T.space['3'],
  },
  priCount: { fontSize: T.compat['22'], fontWeight: '800', fontVariant: ['tabular-nums'] },
  priLabel: { fontSize: T.type.label, color: T.ink2, marginTop: 2 },
  mangaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['3'],
    backgroundColor: T.brand700,
    borderRadius: T.radiusLg,
    padding: T.space['4'],
  },
  mangaTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  mangaSub: { color: 'rgba(255,255,255,0.85)', fontSize: T.type.label, marginTop: 2, maxWidth: 240 },
  actionCard: { flex: 1, backgroundColor: T.surface, borderRadius: T.radiusMd, padding: T.space['3'], gap: T.space['1'], alignItems: 'flex-start' },
  actionTitle: { fontSize: T.type.subheading, fontWeight: '700', color: T.ink },
  actionSub: { fontSize: T.type.label, color: T.ink3 },
});
