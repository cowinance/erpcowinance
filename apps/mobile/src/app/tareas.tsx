/**
 * Pantalla de Tareas (P6-3.b + paridad móvil, auditoría Fase 2): tareas del store LOCAL
 * (bootstrap + puts de la sesión), 100% OFFLINE, agrupadas por urgencia. Permite crear,
 * completar, INICIAR (pending→in_progress), REPROGRAMAR (presets de fecha), ASIGNARME/quitarme
 * y CANCELAR — todo como puts que el TaskSyncHandler aplica con la regla única del TaskService.
 *
 * Sin date-picker nativo a propósito: presets (Hoy / Mañana / +7 d / Sin fecha) son más rápidos
 * con guantes y evitan sumar una dependencia. Asignar en móvil = a MÍ (no hay lista de usuarios
 * local); la asignación a terceros vive en la web.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, TaskRow } from '@/sync/SyncContext';
import { FormScroll, Button } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import { farmToday, addFarmDays } from '../lib/date';

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

/** Presets de reprogramación (offset en días desde hoy; null = sin fecha). */
const RESCHEDULE: { label: string; days: number | null }[] = [
  { label: 'Hoy', days: 0 },
  { label: 'Mañana', days: 1 },
  { label: '+7 d', days: 7 },
  { label: 'Sin fecha', days: null },
];
const dateIn = (days: number) => addFarmDays(farmToday(), days);

export default function TareasScreen() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [mineOnly, setMineOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // fuerza re-lectura de sync.tasks() tras cada acción

  const refresh = () => setTick((n) => n + 1);
  const all = sync.tasks();
  const myId = sync.userId;
  // Abiertas = pendientes + en curso (el estado in_progress llegó con la mejora de Tareas).
  const open = all.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const visible = mineOnly && myId ? open.filter((t) => t.assigned_to === myId) : open;
  const doneSession = all.filter((t) => t.status === 'done');
  const today = farmToday();
  const mineCount = myId ? open.filter((t) => t.assigned_to === myId).length : 0;

  function create() {
    if (!title.trim()) return;
    sync.captureTaskCreate(title, { priority });
    setTitle('');
    setPriority('normal');
    refresh();
  }

  const act = (fn: () => void) => {
    fn();
    setExpanded(null);
    refresh();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }} key={tick}>
      <FormScroll contentContainerStyle={{ padding: T.space['4'], gap: 14 }}>
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

        {/* Filtro: todas / asignadas a mí */}
        {myId ? (
          <View style={{ flexDirection: 'row', gap: T.space['2'] }}>
            {[
              { label: `Todas (${open.length})`, on: false },
              { label: `Asignadas a mí (${mineCount})`, on: true },
            ].map((f) => {
              const sel = mineOnly === f.on;
              return (
                <Pressable key={f.label} onPress={() => setMineOnly(f.on)} style={[styles.chip, sel && styles.chipSel]}>
                  <Text style={[styles.chipText, sel && { color: T.brand700 }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

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

        {/* Abiertas */}
        <Text style={styles.label}>{mineOnly ? 'Asignadas a mí' : 'Abiertas'}</Text>
        {visible.length === 0 ? (
          <Text style={{ fontSize: T.type.body, color: T.ink3, textAlign: 'center', paddingVertical: T.space['4'] }}>
            {mineOnly ? 'Sin tareas asignadas a vos.' : 'Sin tareas pendientes.'}
          </Text>
        ) : (
          GROUPS.map((g) => {
            const list = visible.filter((t) => urgency(t.due_date, today) === g.key);
            if (!list.length) return null;
            return (
              <View key={g.key} style={{ gap: T.space['1.5'] }}>
                <Text style={styles.group}>
                  {g.label} · {list.length}
                </Text>
                {list.map((t) => {
                  const meta = [
                    t.type === 'health' ? 'Sanidad' : null,
                    t.priority !== 'normal' ? PRIORITIES.find(([v]) => v === t.priority)?.[1] : null,
                    t.due_date ? fmtDate(t.due_date) : null,
                    t.assigned_to && t.assigned_to === myId ? 'mía' : null,
                  ].filter(Boolean);
                  const isOpen = expanded === t.id;
                  return (
                    <View key={t.id} style={styles.card}>
                      <View style={styles.item}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1.5'] }}>
                            <Text style={styles.itemTitle} numberOfLines={2}>{t.title}</Text>
                            {t.status === 'in_progress' && (
                              <Text style={styles.badge}>En curso</Text>
                            )}
                          </View>
                          {meta.length > 0 && <Text style={styles.itemMeta}>{meta.join(' · ')}</Text>}
                        </View>
                        <Pressable onPress={() => act(() => sync.captureTaskComplete(t.id))} style={styles.completeBtn} hitSlop={6}>
                          <Ionicons name="checkmark" size={16} color={T.success} />
                          <Text style={{ fontSize: T.type.label, fontWeight: '600', color: T.success }}>Completar</Text>
                        </Pressable>
                        <Pressable onPress={() => setExpanded(isOpen ? null : t.id)} hitSlop={8} style={{ paddingHorizontal: T.space['1'] }}>
                          <Ionicons name={isOpen ? 'chevron-up' : 'ellipsis-horizontal'} size={18} color={T.ink3} />
                        </Pressable>
                      </View>

                      {isOpen && (
                        <View style={styles.actions}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] }}>
                            {t.status === 'pending' && (
                              <Pressable onPress={() => act(() => sync.captureTaskStart(t.id))} style={styles.actionChip}>
                                <Ionicons name="play" size={13} color={T.brand700} />
                                <Text style={styles.actionText}>Iniciar</Text>
                              </Pressable>
                            )}
                            {myId && (
                              <Pressable
                                onPress={() => act(() => sync.captureTaskAssign(t.id, t.assigned_to === myId ? null : myId))}
                                style={styles.actionChip}
                              >
                                <Ionicons name="person" size={13} color={T.brand700} />
                                <Text style={styles.actionText}>{t.assigned_to === myId ? 'Quitarme' : 'Asignarme'}</Text>
                              </Pressable>
                            )}
                            <Pressable onPress={() => act(() => sync.captureTaskCancel(t.id))} style={styles.actionChip}>
                              <Ionicons name="close" size={13} color={T.danger} />
                              <Text style={[styles.actionText, { color: T.danger }]}>Cancelar</Text>
                            </Pressable>
                          </View>
                          <Text style={styles.reschedLabel}>Reprogramar</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] }}>
                            {RESCHEDULE.map((r) => (
                              <Pressable
                                key={r.label}
                                onPress={() => act(() => sync.captureTaskReschedule(t.id, r.days === null ? null : dateIn(r.days)))}
                                style={styles.actionChip}
                              >
                                <Text style={styles.actionText}>{r.label}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      )}
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
      </FormScroll>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
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
  card: { borderWidth: 1, borderColor: T.borderSubtle, borderRadius: T.radiusSm, backgroundColor: T.sunken, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2'],
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2.5'],
  },
  itemTitle: { fontSize: T.type.body, fontWeight: '600', color: T.ink, flexShrink: 1 },
  itemMeta: { fontSize: T.type.label, color: T.ink3, marginTop: T.space['0.5'] },
  badge: { fontSize: T.type.caption, fontWeight: '700', color: T.info },
  completeBtn: { flexDirection: 'row', alignItems: 'center', gap: T.space['1'], paddingHorizontal: T.space['1'], paddingVertical: T.space['1'] },
  actions: {
    gap: T.space['2'],
    paddingHorizontal: T.space['3'],
    paddingBottom: T.space['3'],
    paddingTop: T.space['1'],
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['1'],
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['2.5'],
    paddingVertical: T.space['1.5'],
    backgroundColor: T.surface,
  },
  actionText: { fontSize: T.type.label, fontWeight: '600', color: T.ink2 },
  reschedLabel: { fontSize: T.type.caption, fontWeight: '600', color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 },
});
