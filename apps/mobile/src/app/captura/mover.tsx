/**
 * Captura «Mover» (P3 M-3.3.b): mueve UN animal a un lote (o lo saca) 100% offline.
 * Emite solo el event op de intención (sync.captureMovement, event-only); el cambio de
 * lote se refleja tras sincronizar (accept-lag: no hay put local). Selección individual
 * con contador de sesión, patrón idéntico a las demás capturas.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { AnimalPickerLocal } from '@/components/AnimalPickerLocal';
import { FormScroll, Button } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import * as haptics from '@/lib/haptics';

const REASONS = ['Rotación', 'Destete', 'Sanitario', 'Venta'];
const CLEAR = 'clear';

export default function MoverCapture() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const lots = sync.lots();
  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [dest, setDest] = useState(''); // '' sin elegir · CLEAR sacar del lote · else lotId
  const [reason, setReason] = useState('');
  const [success, setSuccess] = useState('');
  const [count, setCount] = useState(0);

  const canSave = !!animal && dest !== '';

  function save() {
    if (!animal || dest === '') return;
    const toLotId = dest === CLEAR ? null : dest;
    sync.captureMovement(animal.id, toLotId, reason || undefined);
    haptics.ok();
    const lotName = dest === CLEAR ? 'sin lote' : lots.find((l) => l.id === dest)?.name ?? 'lote';
    setSuccess(`${animal.tag} → ${lotName} · se reflejará al sincronizar`);
    setCount((c) => c + 1);
    setAnimal(null);
    setDest('');
    setReason('');
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
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Mover</Text>

        <View>
          <Text style={styles.label}>Animal *</Text>
          <AnimalPickerLocal animal={animal} onSelect={setAnimal} />
        </View>

        <View>
          <Text style={styles.label}>Lote destino *</Text>
          {lots.length === 0 && (
            <Text style={{ fontSize: T.type.label, color: T.ink3, marginBottom: T.space['2'] }}>
              No hay lotes para asignar — se sincronizan al conectarte. Podés sacar del lote.
            </Text>
          )}
          <View style={{ gap: T.space['2'] }}>
            {lots.map((l) => {
              const sel = dest === l.id;
              return (
                <Pressable key={l.id} onPress={() => setDest(l.id)} style={[styles.option, sel && styles.optionSel]}>
                  <Text style={[styles.optionName, sel && { color: T.brand700 }]}>{l.name}</Text>
                  <Text style={styles.optionSub}>{l.paddock_name ?? 'sin potrero'}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setDest(CLEAR)} style={[styles.option, dest === CLEAR && styles.optionSel]}>
              <Text style={[styles.optionName, dest === CLEAR && { color: T.brand700 }]}>Sacar del lote</Text>
              <Text style={styles.optionSub}>El animal queda sin lote</Text>
            </Pressable>
          </View>
        </View>

        <View>
          <Text style={styles.label}>Motivo</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] }}>
            {REASONS.map((r) => {
              const sel = reason === r;
              return (
                <Pressable key={r} onPress={() => setReason(sel ? '' : r)} style={[styles.chip, sel && styles.optionSel]}>
                  <Text style={[styles.chipText, sel && { color: T.brand700 }]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Opcional (por defecto: movimiento)"
            placeholderTextColor={T.ink3}
            style={[styles.input, { marginTop: T.space['2'] }]}
          />
        </View>

        {!!success && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={16} color={T.success} />
            <Text style={{ fontSize: T.type.body, color: T.success, flex: 1 }}>{success}</Text>
          </View>
        )}

        <Button label="Guardar movimiento" onPress={save} disabled={!canSave} />
        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>
          Se guarda local y se sube solo al sincronizar. El nuevo lote se refleja después de sincronizar.
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
  option: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2.5'],
    gap: T.space['0.5'],
    backgroundColor: T.surface,
  },
  optionSel: { borderColor: T.brand700, backgroundColor: T.brand100 },
  optionName: { fontSize: T.type.body, fontWeight: '600', color: T.ink },
  optionSub: { fontSize: T.type.label, color: T.ink3 },
  chip: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: T.space['3'],
    paddingVertical: T.space['2'],
  },
  chipText: { fontSize: T.type.body, fontWeight: '600', color: T.ink2 },
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
