import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { T } from '@/theme';

/** Selector de animal por caravana contra la base LOCAL (funciona sin señal). */
export function AnimalPickerLocal({
  animal,
  onSelect,
  onlyFemales,
}: {
  animal: AnimalRow | null;
  onSelect: (a: AnimalRow | null) => void;
  onlyFemales?: boolean;
}) {
  const sync = useSync();
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');

  function lookup() {
    setError('');
    const found = sync.findByTag(tag);
    if (!found) return setError(`Sin animal con caravana ${tag.trim()}`);
    if (onlyFemales && found.sex !== 'F') return setError(`${found.tag} es macho`);
    onSelect(found);
    setTag('');
  }

  if (animal) {
    return (
      <View style={styles.chip}>
        <Text style={styles.chipTag}>{animal.tag}</Text>
        <Text style={styles.chipInfo} numberOfLines={1}>
          {animal.category}
          {animal.name ? ` · ${animal.name}` : ''}
          {animal.last_weight_kg ? ` · ${Math.round(animal.last_weight_kg)} kg` : ''}
        </Text>
        <Ionicons name="checkmark-circle" size={18} color={T.success} />
        <Pressable onPress={() => onSelect(null)} hitSlop={8}>
          <Ionicons name="close" size={18} color={T.ink3} />
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={tag}
          onChangeText={setTag}
          onSubmitEditing={lookup}
          placeholder="Caravana…"
          placeholderTextColor={T.ink3}
          keyboardType="number-pad"
          style={styles.input}
        />
        <Pressable onPress={lookup} disabled={!tag.trim()} style={[styles.searchBtn, !tag.trim() && { opacity: 0.4 }]}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: T.ink }}>Buscar</Text>
        </Pressable>
      </View>
      {!!error && <Text style={{ fontSize: 12, color: T.danger, marginTop: 4 }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: 'monospace',
    color: T.ink,
    backgroundColor: T.surface,
  },
  searchBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.borderSubtle,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipTag: { fontFamily: 'monospace', fontSize: 16, fontWeight: '700', color: T.ink },
  chipInfo: { flex: 1, fontSize: 12, color: T.ink2 },
});
