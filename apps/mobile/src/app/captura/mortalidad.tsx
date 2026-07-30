/**
 * Captura «Baja por muerte» (P5-3.b): registra la mortalidad de UN animal 100% offline.
 * Emite solo el event op de intención (sync.captureMortality, event-only, Patrón B); el
 * servidor autora hecho + status='dead' + timeline y converge por server-origin. El estado
 * NO cambia local hasta sincronizar (accept-lag).
 *
 * Acción TERMINAL → confirmación destructiva (Alert.alert) antes de emitir.
 *
 * Protección anti-duplicado SOLO de sesión (UX): como el animal sigue activo localmente
 * hasta recibir el server-origin, se guarda un Set de animales ya dados de baja en esta
 * sesión para no permitir registrar otra baja del mismo. NO es un put optimista ni toca el
 * store — el servidor sigue siendo la autoridad (idempotencia + conflicto definitivo).
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { AnimalPickerLocal } from '@/components/AnimalPickerLocal';
import { FormScroll, Button } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import * as haptics from '@/lib/haptics';

export default function MortalidadCapture() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [notes, setNotes] = useState('');
  const [dup, setDup] = useState('');
  const [success, setSuccess] = useState('');
  const [count, setCount] = useState(0);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  // Protección de sesión: no permitir seleccionar un animal ya dado de baja en esta sesión.
  function handleSelect(a: AnimalRow | null) {
    if (a && doneIds.has(a.id)) {
      setDup(`Ya registraste la baja de ${a.tag} en esta sesión.`);
      return;
    }
    setDup('');
    setAnimal(a);
  }

  const canSave = !!animal && !doneIds.has(animal.id);

  function askConfirm() {
    const a = animal;
    if (!a) return;
    if (doneIds.has(a.id)) {
      setDup(`Ya registraste la baja de ${a.tag} en esta sesión.`);
      return;
    }
    Alert.alert(
      'Confirmar baja',
      `Vas a registrar la baja por muerte de la caravana ${a.tag}. El estado cambia a «muerto» al sincronizar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar baja', style: 'destructive', onPress: () => emit(a) },
      ],
    );
  }

  // Solo se emite tras confirmar. Event-only: sin put optimista ni cambio del store.
  function emit(a: AnimalRow) {
    sync.captureMortality(a.id, notes.trim() || undefined);
    haptics.ok();
    setDoneIds((s) => {
      const next = new Set(s);
      next.add(a.id);
      return next;
    });
    setSuccess(`Baja de ${a.tag} registrada · el estado cambia a «muerto» al sincronizar`);
    setCount((c) => c + 1);
    setAnimal(null);
    setNotes('');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <FormScroll contentContainerStyle={{ padding: T.space['4'], gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1'] }}>
            <Ionicons name="chevron-back" size={18} color={T.ink2} />
            <Text style={{ fontSize: T.type.body, color: T.ink2 }}>Volver</Text>
          </Pressable>
          {count > 0 && <Text style={{ fontSize: T.type.label, color: T.success, fontWeight: '600' }}>{count} en esta sesión</Text>}
        </View>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Baja por muerte</Text>

        <View>
          <Text style={styles.label}>Animal *</Text>
          <AnimalPickerLocal animal={animal} onSelect={handleSelect} />
          {!!dup && (
            <Text style={{ fontSize: T.type.label, color: T.warning, marginTop: T.space['1'] }}>{dup}</Text>
          )}
        </View>

        <View>
          <Text style={styles.label}>Causa / observación</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Opcional — ej. timpanismo, rayo…"
            placeholderTextColor={T.ink3}
            multiline
            style={[styles.input, { height: 88, paddingTop: T.space['2.5'], textAlignVertical: 'top' }]}
          />
        </View>

        {!!success && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={16} color={T.success} />
            <Text style={{ fontSize: T.type.body, color: T.success, flex: 1 }}>{success}</Text>
          </View>
        )}

        <Button label="Registrar baja" variant="danger" onPress={askConfirm} disabled={!canSave} />
        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>
          Se guarda local y se sube al sincronizar. El animal queda «muerto» recién después de sincronizar.
        </Text>
      </FormScroll>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  label: { fontSize: T.type.label, fontWeight: '600', color: T.ink2, marginBottom: T.space['1.5'] },
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
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space['2'],
    backgroundColor: T.brand100,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2.5'],
  },
});
