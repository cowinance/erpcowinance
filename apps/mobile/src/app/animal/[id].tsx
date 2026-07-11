import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useSync } from '@/sync/SyncContext';
import { Card } from '@/components/ui';
import { T } from '@/theme';

const EVENT_LABELS: Record<string, string> = {
  birth: 'Nacimiento',
  weighing: 'Pesaje',
  treatment: 'Tratamiento',
  vaccination: 'Vacunación',
  heat: 'Celo',
  service: 'Servicio',
  pregnancy_diagnosed: 'Diagnóstico de preñez',
  calving: 'Parto',
  weaning: 'Destete',
  death: 'Muerte',
  note: 'Nota',
};

export default function AnimalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sync = useSync();
  const animal = sync.animal(id);
  const events = sync.animalEvents(id);
  const pregnancy = sync.openPregnancy(id);

  if (!animal) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: T.ink2 }}>Animal no encontrado en la base local.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1'] }}>
          <Ionicons name="chevron-back" size={16} color={T.ink2} />
          <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Volver</Text>
        </Pressable>

        <View>
          <Text style={styles.tag}>{animal.tag ?? '—'}</Text>
          <Text style={{ fontSize: T.type.body, color: T.ink2, marginTop: T.space['0.5'] }}>
            {animal.category ?? '—'}
            {animal.name ? ` · ${animal.name}` : ''} · {animal.lot_name ?? 'sin lote'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: T.space['3'] }}>
          <Card style={{ flex: 1 }}>
            <Text style={styles.kpiLabel}>Último peso</Text>
            <Text style={styles.kpiValue}>{animal.last_weight_kg ? `${Math.round(animal.last_weight_kg)} kg` : '—'}</Text>
            <Text style={{ fontSize: T.type.caption, color: T.ink3, marginTop: T.space['0.5'] }}>
              {animal.last_weighed_at ? new Date(animal.last_weighed_at).toLocaleDateString('es-AR') : 'sin pesajes'}
            </Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text style={styles.kpiLabel}>Estado reproductivo</Text>
            <Text style={styles.kpiValue}>{pregnancy ? 'Preñada' : animal.sex === 'F' ? 'Vacía' : '—'}</Text>
            <Text style={{ fontSize: T.type.caption, color: T.ink3, marginTop: T.space['0.5'] }}>
              {pregnancy?.expected_due_date
                ? `parto probable ${new Date(pregnancy.expected_due_date).toLocaleDateString('es-AR')}`
                : animal.sex === 'F'
                  ? 'sin preñez abierta'
                  : 'macho'}
            </Text>
          </Card>
        </View>

        <Card>
          <Text style={{ fontSize: T.type.subheading, fontWeight: '600', color: T.ink, marginBottom: T.space['2.5'] }}>
            Actividad de este dispositivo
          </Text>
          {events.length === 0 ? (
            <Text style={{ fontSize: T.type.body, color: T.ink3 }}>
              Sin capturas locales todavía. El historial completo vive en el servidor; el móvil guarda lo que capturás
              acá (y lo sube al sincronizar).
            </Text>
          ) : (
            events.map((e) => (
              <View key={e.id} style={styles.eventRow}>
                <Text style={{ fontSize: T.type.body, fontWeight: '600', color: T.ink, width: 130 }}>
                  {EVENT_LABELS[e.type] ?? e.type}
                </Text>
                <Text style={{ fontSize: T.type.label, color: T.ink2, flex: 1 }}>
                  {e.type === 'weighing' && e.data.weight_kg ? `${e.data.weight_kg} kg` : ''}
                </Text>
                <Text style={{ fontSize: T.type.caption, color: T.ink3 }}>{new Date(e.at).toLocaleDateString('es-AR')}</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.canvas },
  tag: { fontFamily: 'monospace', fontSize: 32, fontWeight: '700', color: T.ink },
  kpiLabel: { fontSize: T.type.label, color: T.ink2 },
  kpiValue: { fontSize: T.compat['24'], fontWeight: '700', color: T.ink, marginTop: T.space['1'], fontVariant: ['tabular-nums'] },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: T.space['2'],
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
  },
});
