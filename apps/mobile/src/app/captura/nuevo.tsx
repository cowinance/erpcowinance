/**
 * Alta rápida de un animal, desde el corral.
 *
 * **El hueco que tapa.** Era la única cosa del campo que no se podía hacer desde el teléfono: las
 * once acciones del menú de captura operan sobre un animal que YA está cargado. Dar de alta obligaba
 * a volver a la computadora, justo cuando el animal está adelante y la caravana se lee de un vistazo.
 *
 * **Por qué RÁPIDA.** Cuatro datos: caravana, sexo, categoría y de dónde viene. Nada más. El
 * formulario completo de la web —raza, madre, padre, fecha exacta, color— en un celular y con las
 * manos sucias no se llena, se abandona. Lo que falta se completa después, con pantalla y tiempo.
 *
 * **Por qué el origen está y la fecha no.** Son las dos caras de la misma decisión. `origin` se
 * pregunta porque el productor lo sabe de memoria —o nació acá o lo compró— y porque alimenta la
 * tasa de reposición: veinte vaquillonas compradas contadas como propias dan vuelta el indicador. La
 * fecha de nacimiento NO se pregunta ni se rellena con hoy, porque nadie la sabe parado en la manga
 * y un animal de 400 kilos nacido hoy es peor que un animal sin fecha: sin fecha el sistema no
 * calcula edad, con fecha falsa calcula mal y nadie se entera.
 *
 * **Repetir es lo normal.** Cuando baja un camión se cargan veinte, no uno. Por eso el formulario no
 * se cierra al guardar: limpia la caravana, deja sexo y categoría puestos, y lleva la cuenta.
 */
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { validateQuickAdd } from '@cowinance/domain';
import { useSync } from '@/sync/SyncContext';
import { FormScroll, Button } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import * as haptics from '@/lib/haptics';

export default function NuevoAnimalCapture() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();

  const [tag, setTag] = useState('');
  const [sex, setSex] = useState<'F' | 'M' | null>(null);
  const [categoryCode, setCategoryCode] = useState<string | null>(null);
  const [origin, setOrigin] = useState<'born' | 'purchased'>('purchased');
  const [success, setSuccess] = useState('');
  const [count, setCount] = useState(0);

  const categorias = useMemo(() => sync.categoriesInUse(), [sync]);
  const animales = sync.animals();

  // La validación es del dominio: la misma regla que explicaría el servidor, sin una segunda copia.
  const check = validateQuickAdd({ tag, sex, categoryCode }, animales.map((a) => ({ tag: a.tag, status: a.status })));
  const puedeGuardar = check.errors.length === 0;
  const aviso = check.warnings[0]?.message;

  function guardar() {
    if (!puedeGuardar || !sex || !categoryCode) return;
    const label = categorias.find((c) => c.code === categoryCode)?.label ?? categoryCode;
    sync.captureNewAnimal({ tag: check.tag, sex, categoryCode, categoryLabel: label, origin });
    haptics.ok();
    setSuccess(`${check.tag} dada de alta · ${label}`);
    setCount((c) => c + 1);
    setTag(''); // se limpia SOLO la caravana: cargar un camión es repetir sexo y categoría
  }

  // La caravana repetida avisa y deja seguir, igual que el servidor, pero se confirma: el productor
  // tiene que enterarse ANTES de guardar, que es cuando todavía puede releer el número.
  function intentarGuardar() {
    if (!aviso) return guardar();
    haptics.warn();
    Alert.alert('Caravana repetida', aviso, [
      { text: 'Reviso el número', style: 'cancel' },
      { text: 'Guardar igual', onPress: guardar },
    ]);
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
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Nuevo animal</Text>

        <View>
          <Text style={styles.label}>Caravana *</Text>
          <TextInput
            value={tag}
            onChangeText={setTag}
            placeholder="801"
            placeholderTextColor={T.ink3}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, { fontFamily: 'monospace', fontSize: 18 }]}
          />
          {!!aviso && (
            <View style={styles.avisoBox}>
              <Ionicons name="alert-circle-outline" size={16} color={T.warning} />
              <Text style={{ fontSize: T.type.label, color: T.warning, flex: 1 }}>{aviso}</Text>
            </View>
          )}
        </View>

        <View>
          <Text style={styles.label}>Sexo *</Text>
          <View style={styles.row}>
            {([
              { v: 'F' as const, l: 'Hembra' },
              { v: 'M' as const, l: 'Macho' },
            ]).map((o) => (
              <Pressable
                key={o.v}
                onPress={() => { setSex(o.v); haptics.tap(); }}
                style={[styles.chip, sex === o.v && styles.chipOn]}
              >
                <Text style={[styles.chipTxt, sex === o.v && styles.chipTxtOn]}>{o.l}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.label}>Categoría *</Text>
          {categorias.length === 0 ? (
            <Text style={{ fontSize: T.type.label, color: T.ink3 }}>
              Todavía no hay categorías en el teléfono. Sincronizá una vez y volvé.
            </Text>
          ) : (
            <View style={styles.wrap}>
              {categorias.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => { setCategoryCode(c.code); haptics.tap(); }}
                  style={[styles.chip, categoryCode === c.code && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, categoryCode === c.code && styles.chipTxtOn]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View>
          <Text style={styles.label}>¿De dónde viene?</Text>
          <View style={styles.row}>
            {([
              { v: 'purchased' as const, l: 'Comprado' },
              { v: 'born' as const, l: 'Nacido acá' },
            ]).map((o) => (
              <Pressable
                key={o.v}
                onPress={() => { setOrigin(o.v); haptics.tap(); }}
                style={[styles.chip, origin === o.v && styles.chipOn]}
              >
                <Text style={[styles.chipTxt, origin === o.v && styles.chipTxtOn]}>{o.l}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {!!success && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={16} color={T.success} />
            <Text style={{ fontSize: T.type.body, color: T.success, flex: 1 }}>{success}</Text>
          </View>
        )}

        <Button label="Dar de alta" onPress={intentarGuardar} disabled={!puedeGuardar} />
        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>
          Se guarda local y se sube al sincronizar. La fecha de nacimiento, la raza y los padres se
          completan después desde la web.
        </Text>
      </FormScroll>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    label: { fontSize: T.type.label, fontWeight: '600', color: T.ink2, marginBottom: T.space['1.5'] },
    input: {
      minHeight: T.control.base,
      paddingVertical: T.control.padY,
      borderWidth: 1,
      borderColor: T.borderStrong,
      borderRadius: T.radiusSm,
      paddingHorizontal: T.space['3'],
      fontSize: 15,
      color: T.ink,
      backgroundColor: T.surface,
    },
    row: { flexDirection: 'row', gap: T.space['2'] },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space['2'] },
    chip: {
      minHeight: T.control.base,
      justifyContent: 'center',
      paddingHorizontal: T.space['4'],
      paddingVertical: T.space['2'],
      borderRadius: T.radiusSm,
      borderWidth: 1,
      borderColor: T.borderStrong,
      backgroundColor: T.surface,
    },
    chipOn: { backgroundColor: T.brand700, borderColor: T.brand700 },
    chipTxt: { fontSize: T.type.body, fontWeight: '600', color: T.ink2 },
    // '#fff' a mano como en `Button.btnText`: no hay token de «texto sobre marca» y el proyecto ya
    // arrastra esa deuda en manga. Inventar uno acá lo dejaría en dos lugares en vez de uno.
    chipTxtOn: { color: '#fff' },
    avisoBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: T.space['2'],
      marginTop: T.space['2'],
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
