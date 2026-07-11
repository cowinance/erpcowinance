import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { EmptyHerd } from '@/components/EmptyHerd';
import { T } from '@/theme';

function Row({ a }: { a: AnimalRow }) {
  return (
    <Pressable
      onPress={() => router.push(`/animal/${a.id}`)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: T.sunken }]}
    >
      <Text style={styles.tag}>{a.tag ?? '—'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: T.ink }}>
          {a.category ?? '—'}
          {a.name ? ` · ${a.name}` : ''}
        </Text>
        <Text style={{ fontSize: T.type.label, color: T.ink3 }}>{a.lot_name ?? 'sin lote'}</Text>
      </View>
      <Text style={styles.weight}>{a.last_weight_kg ? `${Math.round(a.last_weight_kg)} kg` : '—'}</Text>
    </Pressable>
  );
}

/** Empty-state que distingue carga/error de vacío real (no afirma "sin animales"
 *  mientras el primer bootstrap no terminó). */
function HerdEmpty({ status, query }: { status: string; query: string }) {
  if (status === 'boot') return <Text style={styles.emptyNote}>Preparando tu hato…</Text>;
  if (status === 'error')
    return <Text style={styles.emptyNote}>No se pudo sincronizar. Revisá tu conexión y volvé a intentar.</Text>;
  if (query) return <Text style={styles.emptyNote}>Sin resultados para «{query}».</Text>;
  return <EmptyHerd />;
}

export default function Animales() {
  const sync = useSync();
  const [q, setQ] = useState('');
  const animals = sync.animals(q || undefined);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Animales</Text>
        <Text style={{ fontSize: T.type.label, color: T.ink3, marginTop: 2 }}>
          {animals.length} activos · datos locales (funciona sin señal)
        </Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar por caravana o nombre…"
          placeholderTextColor={T.ink3}
          style={styles.search}
        />
      </View>
      <FlatList
        data={animals}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <Row a={item} />}
        contentContainerStyle={
          animals.length === 0
            ? { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16 }
            : { paddingHorizontal: 16, paddingBottom: 24 }
        }
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: T.borderSubtle }} />}
        ListEmptyComponent={<HerdEmpty status={sync.status} query={q} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  search: {
    marginTop: 10,
    height: 40,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    fontSize: T.type.input,
    color: T.ink,
    backgroundColor: T.surface,
  },
  emptyNote: { fontSize: T.type.body, color: T.ink3, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  tag: { fontFamily: 'monospace', fontSize: 15, fontWeight: '700', color: T.brand700, width: 56 },
  weight: { fontSize: 14, fontWeight: '600', color: T.ink, fontVariant: ['tabular-nums'] },
});
