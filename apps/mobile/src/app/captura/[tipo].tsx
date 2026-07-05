/**
 * Formulario de captura offline por tipo: vacunar, tratar, celo, servicio,
 * diagnóstico de preñez y parto. Todo se escribe contra el store local;
 * los retiros y la fecha probable de parto se calculan EN el dispositivo.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { AnimalPickerLocal } from '@/components/AnimalPickerLocal';
import { Button } from '@/components/ui';
import { T } from '@/theme';

const TITLES: Record<string, string> = {
  vacunar: 'Vacunar',
  tratar: 'Tratar',
  celo: 'Registrar celo',
  servicio: 'Registrar servicio',
  diagnostico: 'Diagnóstico de preñez',
  parto: 'Registrar parto',
};

const ROUTES = [
  ['sc', 'Subcutánea'],
  ['im', 'Intramuscular'],
  ['oral', 'Oral'],
] as const;

function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [V, string])[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          style={[styles.segBtn, value === v && { borderColor: T.brand700, backgroundColor: T.brand100 }]}
        >
          <Text style={[styles.segText, value === v && { color: T.brand700 }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function CaptureForm() {
  const { tipo } = useLocalSearchParams<{ tipo: string }>();
  const sync = useSync();
  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [dose, setDose] = useState('');
  const [batch, setBatch] = useState('');
  const [route, setRoute] = useState<'sc' | 'im' | 'oral'>('sc');
  const [method, setMethod] = useState<'ai' | 'natural'>('ai');
  const [sireId, setSireId] = useState<string | null>(null);
  const [result, setResult] = useState<'pregnant' | 'empty'>('pregnant');
  const [calfSex, setCalfSex] = useState<'F' | 'M'>('F');
  const [calfTag, setCalfTag] = useState('');
  const [success, setSuccess] = useState('');
  const [count, setCount] = useState(0);

  const onlyFemales = ['celo', 'servicio', 'diagnostico', 'parto'].includes(tipo);
  const products = tipo === 'vacunar' ? sync.products('vaccine') : sync.products('other');
  const bulls = sync.bulls();
  const pregnancy = animal ? sync.openPregnancy(animal.id) : null;

  function save() {
    if (!animal) return;
    let msg = '';
    if (tipo === 'vacunar') {
      if (!productId) return;
      sync.captureVaccination(animal.id, productId, dose ? Number(dose) : undefined, batch || undefined);
      msg = `Vacunación guardada para ${animal.tag}`;
    } else if (tipo === 'tratar') {
      if (!productId) return;
      const { meatUntil } = sync.captureTreatment(animal.id, productId, dose ? Number(dose) : undefined, route);
      msg = `Tratamiento guardado para ${animal.tag}${meatUntil ? ` — retiro de carne hasta ${new Date(meatUntil + 'T12:00:00').toLocaleDateString('es-AR')}` : ''}`;
    } else if (tipo === 'celo') {
      sync.captureHeat(animal.id);
      msg = `Celo registrado para ${animal.tag}`;
    } else if (tipo === 'servicio') {
      sync.captureService(animal.id, method, method === 'natural' ? (sireId ?? undefined) : undefined);
      msg = `Servicio (${method === 'ai' ? 'IA' : 'monta'}) registrado para ${animal.tag}`;
    } else if (tipo === 'diagnostico') {
      const { expectedDue } = sync.captureDiagnosis(animal.id, result);
      msg =
        result === 'pregnant'
          ? `${animal.tag} preñada — parto probable ${expectedDue ? new Date(expectedDue + 'T12:00:00').toLocaleDateString('es-AR') : ''}`
          : `${animal.tag} vacía`;
    } else if (tipo === 'parto') {
      sync.captureCalving(animal.id, { sex: calfSex, tag: calfTag || undefined });
      msg = `Parto de ${animal.tag} guardado — cría ${calfTag || 'sin caravana'} dada de alta`;
    }
    setSuccess(msg);
    setCount((c) => c + 1);
    setAnimal(null);
    setDose('');
    setBatch('');
    setCalfTag('');
  }

  const canSave =
    !!animal &&
    ((tipo !== 'vacunar' && tipo !== 'tratar') || !!productId) &&
    (tipo !== 'diagnostico' || result === 'empty' || !pregnancy);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="chevron-back" size={18} color={T.ink2} />
            <Text style={{ fontSize: 13, color: T.ink2 }}>Volver</Text>
          </Pressable>
          {count > 0 && <Text style={{ fontSize: 12, color: T.success, fontWeight: '600' }}>{count} en esta sesión</Text>}
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: T.ink }}>{TITLES[tipo] ?? tipo}</Text>

        <View>
          <Text style={styles.label}>{tipo === 'parto' ? 'Madre' : 'Animal'} *</Text>
          <AnimalPickerLocal animal={animal} onSelect={setAnimal} onlyFemales={onlyFemales} />
          {animal && pregnancy && tipo !== 'parto' && (
            <Text style={{ fontSize: 12, color: T.info, marginTop: 4 }}>
              Preñada — parto probable{' '}
              {pregnancy.expected_due_date ? new Date(pregnancy.expected_due_date).toLocaleDateString('es-AR') : '—'}
            </Text>
          )}
          {animal && tipo === 'diagnostico' && pregnancy && result === 'pregnant' && (
            <Text style={{ fontSize: 12, color: T.warning, marginTop: 4 }}>Ya tiene una preñez abierta.</Text>
          )}
          {animal && tipo === 'parto' && !pregnancy && (
            <Text style={{ fontSize: 12, color: T.warning, marginTop: 4 }}>
              Sin preñez abierta registrada — el parto se guarda igual.
            </Text>
          )}
        </View>

        {(tipo === 'vacunar' || tipo === 'tratar') && (
          <View>
            <Text style={styles.label}>{tipo === 'vacunar' ? 'Vacuna' : 'Producto'} *</Text>
            <View style={{ gap: 8 }}>
              {products.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setProductId(p.id)}
                  style={[styles.productRow, productId === p.id && { borderColor: T.brand700, backgroundColor: T.brand100 }]}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: T.ink }}>{p.name}</Text>
                  <Text style={{ fontSize: 11, color: T.ink3 }}>
                    {p.default_dose ?? ''}
                    {p.withdrawal_meat_days ? ` · retiro ${p.withdrawal_meat_days} d` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {(tipo === 'vacunar' || tipo === 'tratar') && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Dosis (ml)</Text>
              <TextInput value={dose} onChangeText={setDose} keyboardType="decimal-pad" placeholder="2" placeholderTextColor={T.ink3} style={styles.input} />
            </View>
            {tipo === 'vacunar' ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Lote del frasco</Text>
                <TextInput value={batch} onChangeText={setBatch} placeholder="AF-…" placeholderTextColor={T.ink3} style={styles.input} />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Vía</Text>
                <Segmented options={ROUTES} value={route} onChange={setRoute} />
              </View>
            )}
          </View>
        )}

        {tipo === 'servicio' && (
          <>
            <View>
              <Text style={styles.label}>Método</Text>
              <Segmented
                options={[
                  ['ai', 'Inseminación'],
                  ['natural', 'Monta natural'],
                ] as const}
                value={method}
                onChange={setMethod}
              />
            </View>
            {method === 'natural' && (
              <View>
                <Text style={styles.label}>Toro</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {bulls.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => setSireId(sireId === b.id ? null : b.id)}
                      style={[styles.segBtn, sireId === b.id && { borderColor: T.brand700, backgroundColor: T.brand100 }]}
                    >
                      <Text style={[styles.segText, sireId === b.id && { color: T.brand700 }]}>{b.tag}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {tipo === 'diagnostico' && (
          <View>
            <Text style={styles.label}>Resultado</Text>
            <Segmented
              options={[
                ['pregnant', 'Preñada'],
                ['empty', 'Vacía'],
              ] as const}
              value={result}
              onChange={setResult}
            />
          </View>
        )}

        {tipo === 'parto' && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Sexo de la cría</Text>
              <Segmented
                options={[
                  ['F', 'Hembra'],
                  ['M', 'Macho'],
                ] as const}
                value={calfSex}
                onChange={setCalfSex}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Caravana de la cría</Text>
              <TextInput value={calfTag} onChangeText={setCalfTag} keyboardType="number-pad" placeholder="801" placeholderTextColor={T.ink3} style={[styles.input, { fontFamily: 'monospace' }]} />
            </View>
          </View>
        )}

        {!!success && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={16} color={T.success} />
            <Text style={{ fontSize: 13, color: T.success, flex: 1 }}>{success}</Text>
          </View>
        )}

        <Button label={`Guardar ${TITLES[tipo]?.toLowerCase() ?? ''}`} onPress={save} disabled={!canSave} />
        <Text style={{ fontSize: 11, color: T.ink3, textAlign: 'center' }}>
          Se guarda local y se sube solo al sincronizar.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', color: T.ink2, marginBottom: 6 },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    fontSize: 15,
    color: T.ink,
    backgroundColor: T.surface,
  },
  segBtn: {
    flexGrow: 1,
    height: 44,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  segText: { fontSize: 13, fontWeight: '600', color: T.ink2 },
  productRow: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.brand100,
    borderRadius: T.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
