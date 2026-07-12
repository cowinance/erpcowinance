/**
 * Pantalla de Tareas (P6-3.b): lista las tareas pendientes del store LOCAL (bootstrap +
 * puts de la sesión), 100% offline, agrupadas por urgencia. Permite crear (put optimista)
 * y completar (put status='done' + completed_at del device). Ruta stack `/tareas`.
 *
 * Cancelar es acción de oficina (web) — el handler no acepta cancelar del device en P6.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, TaskRow } from '@/sync/SyncContext';
import { Button } from '@/components/ui';
import { T } from '@/theme';

const PRIORITIES: [string, string][] = [
  ['low', 'Baja'],
  ['normal', 'Normal'],
  ['high', 'Alta'],
  ['urgent', 'Urgente'],
];
const GROUPS: { key: 'overdue' | 'today' | 'upcoming' | 'nodate'; label: string }[] = [
  { key: 'overdue', label: 'Vencidas' },
  { key: 'today', label: 'Hoy' },
  { key: 'upcoming', label: 'Próximas' },
  { key: 'nodate', label: 'Sin fecha' },
];

function urgency(due: string | null, today: string): 'overdue' | 'today' | 'upcoming' | 'nodate' {
  if (!due) return 'nodate';
  const d = due.slice(0, 10);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return 'upcoming';
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export default function TareasScreen() {
  const sync = useSync();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [tick, setTick] = useState(0); // fuerza re-lectura de sync.tasks() tras cada acción

  const all = sync.tasks();
  const pending = all.filter((t) => t.status === 'pending');
  const doneSession = all.filter((t) => t.status === 'done');
  const today = new Date().toISOString().slice(0, 10);

  function create() {
    if (!title.trim()) return;
    sync.captureTaskCreate(title, { priority });
    setTitle('');
    setPriority('normal');
    setTick((n) => n + 1);
  }

  function complete(t: TaskRow) {
    sync.captureTaskComplete(t.id);
    setTick((n) => n + 1);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }} key={tick}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1'] }}>
            <Ionicons name="chevron-back" size={18} color={T.ink2} />
            <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Volver</Text>
          </Pressable>
          {doneSession.length > 0 && (
            <Text style={{ fontSize: T.type.label, color: T.success, fontWeight: '600' }}>{doneSession.length} hechas en esta sesión</Text>
          )}
        </View>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Tareas</Text>

        {/* Crear */}
        <View style={{ gap: T.space['2'] }}>
          <Text style={styles.label}>Nueva tarea</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Arreglar aguada…" placeholderTextColor={T.ink3} style={styles.input} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] }}>
            {PRIORITIES.map(([v, label]) => {
              const sel = priority === v;
              return (
                <Pressable key={v} onPress={() => setPriority(v)} style={[styles.chip, sel && styles.chipSel]}>
                  <Text style={[styles.chipText, sel && { color: T.brand700 }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button label="Agregar tarea" onPress={create} disabled={!title.trim()} />
        </View>

        {/* Pendientes */}
        <Text style={styles.label}>Pendientes</Text>
        {pending.length === 0 ? (
          <Text style={{ fontSize: T.type.body, color: T.ink3, textAlign: 'center', paddingVertical: T.space['4'] }}>Sin tareas pendientes.</Text>
        ) : (
          GROUPS.map((g) => {
            const list = pending.filter((t) => urgency(t.due_date, today) === g.key);
            if (!list.length) return null;
            return (
              <View key={g.key} style={{ gap: T.space['1.5'] }}>
                <Text style={styles.group}>
                  {g.label} · {list.length}
                </Text>
                {list.map((t) => {
                  const meta = [t.type === 'health' ? 'Sanidad' : null, t.priority !== 'normal' ? PRIORITIES.find(([v]) => v === t.priority)?.[1] : null, t.due_date ? fmtDate(t.due_date) : null].filter(Boolean);
                  return (
                    <View key={t.id} style={styles.item}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.itemTitle} numberOfLines={2}>{t.title}</Text>
                        {meta.length > 0 && <Text style={styles.itemMeta}>{meta.join(' · ')}</Text>}
                      </View>
                      <Pressable onPress={() => complete(t)} style={styles.completeBtn} hitSlop={6}>
                        <Ionicons name="checkmark" size={16} color={T.success} />
                        <Text style={{ fontSize: T.type.label, fontWeight: '600', color: T.success }}>Completar</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}

        {doneSession.length > 0 && (
          <View style={{ gap: T.space['1'] }}>
            <Text style={styles.group}>Hechas · {doneSession.length}</Text>
            {doneSession.map((t) => (
              <Text key={t.id} style={{ fontSize: T.type.body, color: T.ink3, textDecorationLine: 'line-through', paddingHorizontal: T.space['3'] }} numberOfLines={1}>
                {t.title}
              </Text>
            ))}
          </View>
        )}

        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>Se guarda local y se sube al sincronizar.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: T.type.label, fontWeight: '600', color: T.ink2 },
  group: { fontSize: T.type.caption, fontWeight: '600', letterSpacing: 0.5, color: T.ink3, textTransform: 'uppercase' },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['3'],
    fontSize: 15,
    color: T.ink,
    backgroundColor: T.surface,
  },
  chip: { borderWidth: 1, borderColor: T.borderStrong, borderRadius: T.radiusSm, paddingHorizontal: T.space['3'], paddingVertical: T.space['2'] },
  chipSel: { borderColor: T.brand700, backgroundColor: T.brand100 },
  chipText: { fontSize: T.type.body, fontWeight: '600', color: T.ink2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['3'],
    borderWidth: 1,
    borderColor: T.borderSubtle,
    borderRadius: T.radiusSm,
    backgroundColor: T.sunken,
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2.5'],
  },
  itemTitle: { fontSize: T.type.body, fontWeight: '600', color: T.ink },
  itemMeta: { fontSize: T.type.label, color: T.ink3, marginTop: T.space['0.5'] },
  completeBtn: { flexDirection: 'row', alignItems: 'center', gap: T.space['1'], paddingHorizontal: T.space['2'], paddingVertical: T.space['1'] },
});
