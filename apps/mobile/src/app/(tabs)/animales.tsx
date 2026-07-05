import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSync, AnimalRow } from '@/sync/SyncContext';
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
        <Text style={{ fontSize: 12, color: T.ink3 }}>{a.lot_name ?? 'sin lote'}</Text>
      </View>
      <Text style={styles.weight}>{a.last_weight_kg ? `${Math.round(a.last_weight_kg)} kg` : '—'}</Text>
    </Pressable>
  );
}

export default function Animales() {
  const sync = useSync();
  const [q, setQ] = useState('');
  const animals = sync.animals(q || undefined);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: T.ink }}>Animales</Text>
        <Text style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: T.borderSubtle }} />}
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
    fontSize: 14,
    color: T.ink,
    backgroundColor: T.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  tag: { fontFamily: 'monospace', fontSize: 15, fontWeight: '700', color: T.brand700, width: 56 },
  weight: { fontSize: 14, fontWeight: '600', color: T.ink, fontVariant: ['tabular-nums'] },
});
