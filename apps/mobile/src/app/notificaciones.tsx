/**
 * Pantalla de Notificaciones (P7-4.c.2): feed in_app cacheado por usuario, 100% offline-first.
 * Muestra el snapshot al instante y refresca best-effort al enfocarse (refreshNotifications, que
 * ya aísla su try/catch del sync CRDT). Fuente ÚNICA de verdad: sync.notifications() (reconciliado
 * y ordenado) y sync.unreadNotifications() para el badge — la pantalla no reordena ni recalcula.
 *
 * Marcar leída es local-first: baja el badge al instante y navega al deep-link aunque el POST /read
 * quede pendiente (la intención vive en el read-set persistido). Ruta stack `/notificaciones`.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, type CachedNotification } from '@/sync/SyncContext';
import { notificationHref } from '@/sync/notification-nav';
import { relativeTime } from '@/lib/relative-time';
import { Button, Card } from '@/components/ui';
import { useSyncRefresh } from '@/components/refresh';
import { useStyles, useTheme, type Theme } from '@/useTheme';

function icon(relatedType: string | null): keyof typeof Ionicons.glyphMap {
  if (relatedType === 'animal') return 'paw-outline';
  if (relatedType === 'task') return 'checkbox-outline';
  return 'notifications-outline';
}

function hint(relatedType: string | null): string | undefined {
  if (relatedType === 'animal') return 'Abre la ficha del animal';
  if (relatedType === 'task') return 'Abre las tareas';
  return undefined;
}

/** Fecha absoluta para el texto accesible; tolera valores inválidos. */
function absoluteDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR');
}

export default function Notificaciones() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const refresh = sync.refreshNotifications;
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // El gesto hace un sync COMPLETO, no solo releer el feed: `syncNow` ya llama adentro a
  // `refreshNotifications`, y de paso sube lo que quedó en cola. El `refreshing` de acá sigue
  // siendo el del refresco al enfocar, que es el que escribe «actualizando…» en el encabezado.
  const refreshControl = useSyncRefresh();

  // Refresh best-effort al enfocar, con callback estable (evita refrescos por cada render).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setRefreshing(true);
      refresh().finally(() => {
        if (alive) setRefreshing(false);
      });
      return () => {
        alive = false;
      };
    }, [refresh]),
  );

  const items = sync.notifications(); // ya reconciliado y ordenado (fuente única)
  const at = sync.notificationsAt;

  const open = (n: CachedNotification) => {
    if (busyId === n.id) return; // 1) impedir un segundo tap inmediato sobre el mismo ítem
    if (n.status !== 'read') {
      setBusyId(n.id);
      // 2-3) local-first: markNotificationRead actualiza metaRef y baja el badge antes del await de
      // red; no se espera la confirmación HTTP para navegar. Un fallo de red conserva el pendiente.
      sync.markNotificationRead(n.id).finally(() => setBusyId(null));
    }
    const href = notificationHref(n);
    if (href) router.push(href as Href); // 4) navegar aunque el POST quede pendiente
    // sin destino: se marcó leída y permanece en pantalla, sin error de navegación
  };

  const header = (right?: string) => (
    <View style={styles.headerRow}>
      <Text style={styles.h1}>Notificaciones</Text>
      {right ? <Text style={styles.muted}>{right}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView refreshControl={refreshControl} contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        {header(at ? (refreshing ? 'actualizando…' : `actualizado ${relativeTime(at)}`) : undefined)}

        {items.length === 0 ? (
          <Card>
            {!at && refreshing ? (
              <Text style={styles.muted}>Buscando novedades…</Text>
            ) : !at ? (
              <>
                <Text style={styles.muted}>Sincronizá para ver tus novedades.</Text>
                <View style={{ marginTop: T.space['3'] }}>
                  <Button label={sync.syncing ? 'Sincronizando…' : 'Sincronizar ahora'} onPress={() => sync.syncNow()} disabled={sync.syncing} />
                </View>
              </>
            ) : (
              <Text style={styles.empty}>Sin novedades ✓</Text>
            )}
          </Card>
        ) : (
          <Card>
            {items.map((n, idx) => {
              const unread = n.status !== 'read';
              const href = notificationHref(n);
              const rel = relativeTime(n.created_at);
              const abs = absoluteDate(n.created_at);
              return (
                <Pressable
                  key={n.id}
                  onPress={() => open(n)}
                  disabled={busyId === n.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${unread ? 'No leída. ' : ''}${n.title}${n.body ? '. ' + n.body : ''}${abs ? '. ' + abs : ''}`}
                  accessibilityHint={hint(n.related_type)}
                  style={({ pressed }) => [
                    styles.item,
                    idx > 0 && styles.itemBorder,
                    unread && styles.itemUnread,
                    pressed && { backgroundColor: T.sunken },
                    busyId === n.id && { opacity: 0.6 },
                  ]}
                >
                  {/* Señal 1: punto/indicador de presencia (no solo color) */}
                  <View style={unread ? styles.dotUnread : styles.dotRead} />
                  <Ionicons name={icon(n.related_type)} size={18} color={T.ink3} />
                  <View style={{ flex: 1 }}>
                    {/* Señal 2: peso tipográfico */}
                    <Text style={[styles.title, unread ? styles.titleUnread : styles.titleRead]} numberOfLines={2}>
                      {unread ? '• ' : ''}
                      {n.title}
                    </Text>
                    {n.body ? (
                      <Text style={styles.body} numberOfLines={2}>
                        {n.body}
                      </Text>
                    ) : null}
                  </View>
                  {rel ? <Text style={styles.time}>{rel}</Text> : null}
                  {href ? <Ionicons name="chevron-forward" size={16} color={T.ink3} /> : null}
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  h1: { fontSize: T.type.title, fontWeight: '700', color: T.ink },
  muted: { fontSize: T.type.label, color: T.ink3 },
  empty: { fontSize: T.type.body, color: T.success, fontWeight: '600', paddingVertical: T.space['2'] },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2.5'],
    paddingVertical: T.space['3'],
    paddingHorizontal: T.space['1'],
    minHeight: 48, // target táctil
    borderRadius: T.radiusSm,
  },
  itemBorder: { borderTopWidth: 1, borderTopColor: T.borderSubtle },
  // Señal 3: fondo complementario
  itemUnread: { backgroundColor: T.brand100 },
  dotUnread: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.brand700 },
  dotRead: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'transparent' },
  title: { fontSize: T.type.body },
  titleUnread: { fontWeight: '700', color: T.ink },
  titleRead: { fontWeight: '400', color: T.ink2 },
  body: { fontSize: T.type.label, color: T.ink3, marginTop: 1 },
  time: { fontSize: T.type.label, color: T.ink3 },
});
