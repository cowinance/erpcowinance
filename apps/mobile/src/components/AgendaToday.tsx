/**
 * Sección «Hoy» del home (P4-3): la agenda diaria cacheada (sync.agenda(), P4-2),
 * agrupada por urgencia (Vencidos / Hoy / Próximos), con acción directa. Tocar un ítem
 * de animal navega a su ficha; los de tarea son informativos. 100% offline (lee el
 * último snapshot cacheado); muestra su antigüedad.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui';
import { useSync, type AgendaItem } from '@/sync/SyncContext';
import { relativeTime } from '@/lib/relative-time';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import { farmToday } from '../lib/date';

const GROUPS: { key: 'overdue' | 'today' | 'upcoming'; label: string }[] = [
  { key: 'overdue', label: 'Vencidos' },
  { key: 'today', label: 'Hoy' },
  { key: 'upcoming', label: 'Próximos' },
];

const ICON: Record<AgendaItem['action'], keyof typeof Ionicons.glyphMap> = {
  vaccinate: 'shield-checkmark-outline',
  review_pregnancy: 'pulse-outline',
  view_animal: 'paw-outline',
  complete_task: 'checkbox-outline',
};

function urgency(item: AgendaItem, todayStr: string): 'overdue' | 'today' | 'upcoming' {
  if (!item.due_at) return 'upcoming';
  const d = item.due_at.slice(0, 10);
  if (d < todayStr) return 'overdue';
  if (d === todayStr) return 'today';
  return 'upcoming';
}

export function AgendaToday() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [, setTick] = useState(0); // fuerza re-lectura tras completar una tarea offline
  const agendaAt = sync.agendaAt;
  const todayStr = farmToday();

  // Cross-ref con el store LOCAL (P6-3.c): el snapshot cacheado no se refresca offline, así
  // que se ocultan los ítems de tarea que ya están completadas/canceladas localmente (el put
  // de captureTaskComplete las marcó). Así la agenda se auto-corrige sin esperar al sync.
  const closedTaskIds = new Set(sync.tasks().filter((t) => t.status !== 'pending').map((t) => t.id));
  const items = sync.agenda().filter((i) => !(i.related_type === 'task' && i.related_id && closedTaskIds.has(i.related_id)));

  const completeTask = (i: AgendaItem) => {
    if (i.related_type === 'task' && i.related_id) {
      sync.captureTaskComplete(i.related_id);
      setTick((n) => n + 1);
    }
  };

  const header = (right?: string) => (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Hoy</Text>
      {right ? <Text style={styles.muted}>{right}</Text> : null}
    </View>
  );

  if (!agendaAt) {
    return (
      <Card>
        {header()}
        <Text style={styles.muted}>Sincronizá para ver la agenda del día.</Text>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        {header(`actualizado ${relativeTime(agendaAt)}`)}
        <Text style={styles.empty}>Sin pendientes hoy ✓</Text>
      </Card>
    );
  }

  const grouped = GROUPS.map((g) => ({ ...g, list: items.filter((i) => urgency(i, todayStr) === g.key) })).filter((g) => g.list.length);

  const onPress = (i: AgendaItem) => {
    if (i.related_type === 'animal' && i.related_id) router.push(`/animal/${i.related_id}` as any);
  };

  return (
    <Card>
      {header(`actualizado ${relativeTime(agendaAt)}`)}
      {grouped.map((g) => (
        <View key={g.key} style={{ marginTop: T.space['2'] }}>
          <Text style={styles.group}>
            {g.label} · {g.list.length}
          </Text>
          {g.list.map((i, idx) => {
            const tappable = i.related_type === 'animal' && !!i.related_id;
            const isTask = i.related_type === 'task' && !!i.related_id;
            const color = i.severity === 'warning' || i.severity === 'critical' ? T.warning : T.info;
            return (
              <Pressable
                key={`${i.code}:${i.related_id ?? idx}`}
                onPress={() => onPress(i)}
                disabled={!tappable}
                style={({ pressed }) => [styles.item, pressed && tappable && { backgroundColor: T.sunken }]}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Ionicons name={ICON[i.action]} size={16} color={T.ink2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{i.title}</Text>
                  {!!i.message && <Text style={styles.itemMsg}>{i.message}</Text>}
                </View>
                {tappable && <Ionicons name="chevron-forward" size={16} color={T.ink3} />}
                {isTask && (
                  <Pressable onPress={() => completeTask(i)} hitSlop={6} style={styles.completeBtn}>
                    <Ionicons name="checkmark" size={15} color={T.success} />
                    <Text style={styles.completeText}>Completar</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.space['1'] },
  title: { fontSize: T.type.body, fontWeight: '700', color: T.ink },
  muted: { fontSize: T.type.label, color: T.ink3 },
  empty: { fontSize: T.type.body, color: T.success, fontWeight: '600' },
  group: { fontSize: T.type.label, fontWeight: '600', color: T.ink3, marginBottom: T.space['1'], textTransform: 'uppercase', letterSpacing: 0.4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: T.space['2'], paddingVertical: T.space['2'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemTitle: { fontSize: T.type.body, fontWeight: '600', color: T.ink },
  itemMsg: { fontSize: T.type.label, color: T.ink3, marginTop: 1 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', gap: T.space['1'], paddingHorizontal: T.space['1.5'], paddingVertical: T.space['1'] },
  completeText: { fontSize: T.type.label, fontWeight: '600', color: T.success },
});
