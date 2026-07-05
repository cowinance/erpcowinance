/**
 * Modo manga nativo (doc diseño §12.3) — captura 100% OFFLINE:
 * busca el animal en la base local por caravana, guarda el pesaje como
 * changeset local y sube al sincronizar. Alto contraste AAA, targets 56px+.
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSync, AnimalRow } from '@/sync/SyncContext';

const GREEN = '#4ADE80';
const RED = '#F87171';
const CC_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5];

export default function Manga() {
  const sync = useSync();
  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [tag, setTag] = useState('');
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [lastSaved, setLastSaved] = useState('');
  const [error, setError] = useState('');
  const kgRef = useRef<TextInput>(null);
  const tagRef = useRef<TextInput>(null);

  function lookup() {
    setError('');
    const found = sync.findByTag(tag);
    if (!found) {
      setError(`SIN ANIMAL ${tag.trim().toUpperCase()}`);
      Vibration.vibrate(300);
      return;
    }
    setAnimal(found);
    setTag('');
    setTimeout(() => kgRef.current?.focus(), 100);
  }

  function save() {
    if (!animal || !kg) return;
    sync.captureWeighing(animal.id, Number(kg), cc ?? undefined);
    Vibration.vibrate(80);
    setCount((c) => c + 1);
    setLastSaved(`${animal.tag} · ${kg} kg`);
    setAnimal(null);
    setKg('');
    setCc(null);
    setError('');
    setTimeout(() => tagRef.current?.focus(), 100);
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.topLabel}>MODO MANGA</Text>
        <Text style={styles.counter}>
          {count} {count === 1 ? 'registrado' : 'registrados'}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.exitBtn}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Salir</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {!animal ? (
          <>
            <Text style={styles.stepLabel}>CARAVANA</Text>
            <TextInput
              ref={tagRef}
              value={tag}
              onChangeText={setTag}
              onSubmitEditing={lookup}
              keyboardType="number-pad"
              autoFocus
              style={styles.tagInput}
              accessibilityLabel="Caravana del animal"
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!lastSaved && !error && (
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
                Último guardado: <Text style={{ color: GREEN, fontFamily: 'monospace' }}>{lastSaved}</Text>
              </Text>
            )}
            <Pressable onPress={lookup} disabled={!tag.trim()} style={[styles.bigBtn, { backgroundColor: '#fff' }, !tag.trim() && { opacity: 0.3 }]}>
              <Text style={[styles.bigBtnText, { color: '#000' }]}>BUSCAR</Text>
            </Pressable>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center' }}>
              Búsqueda 100% local — funciona sin señal
            </Text>
          </>
        ) : (
          <>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.bigTag}>{animal.tag}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, marginTop: 4 }}>
                {animal.category}
                {animal.last_weight_kg ? ` · último ${Math.round(animal.last_weight_kg)} kg` : ''}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput
                ref={kgRef}
                value={kg}
                onChangeText={setKg}
                onSubmitEditing={save}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.2)"
                style={styles.kgInput}
                accessibilityLabel="Peso en kilogramos"
              />
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 22, fontWeight: '700', paddingBottom: 10 }}>kg</Text>
            </View>

            <View style={{ width: '100%', maxWidth: 420 }}>
              <Text style={[styles.stepLabel, { textAlign: 'center', marginBottom: 8 }]}>CONDICIÓN CORPORAL</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {CC_OPTIONS.map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => setCc(cc === v ? null : v)}
                    style={[styles.ccBtn, cc === v && { backgroundColor: GREEN }]}
                  >
                    <Text style={[styles.ccText, cc === v && { color: '#000' }]}>{v}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable onPress={save} disabled={!kg} style={[styles.bigBtn, { backgroundColor: GREEN }, !kg && { opacity: 0.3 }]}>
              <Text style={[styles.bigBtnText, { color: '#000' }]}>GUARDAR Y SIGUIENTE</Text>
            </Pressable>
            <Pressable onPress={() => (setAnimal(null), setKg(''), setCc(null))}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecorationLine: 'underline' }}>
                Cambiar animal
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  topLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700', letterSpacing: 3 },
  counter: { color: GREEN, fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  exitBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: 24 },
  stepLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  tagInput: {
    width: 260,
    borderBottomWidth: 4,
    borderBottomColor: 'rgba(255,255,255,0.4)',
    color: '#fff',
    fontSize: 56,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
    paddingVertical: 4,
  },
  kgInput: {
    width: 200,
    borderBottomWidth: 4,
    borderBottomColor: 'rgba(255,255,255,0.4)',
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
    paddingVertical: 4,
  },
  bigTag: { color: GREEN, fontSize: 56, fontWeight: '700', fontFamily: 'monospace' },
  bigBtn: { height: 68, width: '100%', maxWidth: 420, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bigBtnText: { fontSize: 22, fontWeight: '800' },
  ccBtn: { flex: 1, height: 54, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  ccText: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '700' },
  error: { color: RED, fontSize: 20, fontWeight: '700' },
});
