/**
 * Capturador rápido (doc diseño §3.2): el botón central abre una hoja con
 * las acciones de campo más frecuentes. Todas funcionan offline.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/sync/SyncContext';
import { EmptyHerd } from '@/components/EmptyHerd';
import { useStyles, useTheme, type Theme } from '@/useTheme';

/**
 * `cap` es la capacidad de ESCRITURA que exige el servidor para esa captura — la misma que
 * `CAPACIDAD_DE_ESCRITURA` usa para aceptar o rechazar el push.
 *
 * Sin esto la app ofrecía las doce a todo el mundo: un operario podía registrar un servicio
 * reproductivo, guardarlo offline, y enterarse del 403 recién al volver la señal con el trabajo del
 * día hecho. Un botón que guarda algo destinado a ser rechazado es peor que un botón ausente.
 *
 * Los nombres se escriben a mano porque el móvil no comparte código con la API; un test del lado
 * del servidor lee ESTE archivo y falla si alguno deja de existir en la matriz, que es la misma
 * técnica con la que el gate revisa los altos fijos del móvil.
 */
const ACTIONS: { tipo: string; label: string; icon: keyof typeof Ionicons.glyphMap; href: string; cap: string }[] = [
  // Primero porque es el principio de todo: sin el animal cargado, ninguna de las otras diez sirve.
  { tipo: 'nuevo', label: 'Nuevo animal', icon: 'add-outline', href: '/captura/nuevo', cap: 'hato' },
  { tipo: 'pesar', label: 'Pesar (manga)', icon: 'speedometer-outline', href: '/manga', cap: 'pesajes' },
  { tipo: 'vacunar', label: 'Vacunar', icon: 'shield-checkmark-outline', href: '/captura/vacunar', cap: 'sanidad.aplicar' },
  { tipo: 'tratar', label: 'Tratar', icon: 'medkit-outline', href: '/captura/tratar', cap: 'sanidad.aplicar' },
  { tipo: 'celo', label: 'Celo', icon: 'heart-outline', href: '/captura/celo', cap: 'reproduccion' },
  { tipo: 'servicio', label: 'Servicio', icon: 'git-merge-outline', href: '/captura/servicio', cap: 'reproduccion' },
  { tipo: 'diagnostico', label: 'Diag. preñez', icon: 'pulse-outline', href: '/captura/diagnostico', cap: 'reproduccion' },
  { tipo: 'parto', label: 'Parto', icon: 'add-circle-outline', href: '/captura/parto', cap: 'reproduccion' },
  { tipo: 'mover', label: 'Mover', icon: 'swap-horizontal-outline', href: '/captura/mover', cap: 'movimientos' },
  { tipo: 'destete', label: 'Destete', icon: 'cut-outline', href: '/captura/destete', cap: 'reproduccion' },
  { tipo: 'nota', label: 'Nota', icon: 'create-outline', href: '/captura/nota', cap: 'hato' },
  { tipo: 'mortalidad', label: 'Baja', icon: 'alert-circle-outline', href: '/captura/mortalidad', cap: 'mortandad' },
];

export default function CapturaMenu() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  // Todas las capturas requieren un animal ya existente. Con el store vacío no se
  // ofrece ninguna (pesaje/vacunación/tratamiento/celo/servicio/diagnóstico/parto):
  // no hay animal que seleccionar. Las pantallas de captura siguen siendo la
  // autoridad sobre la elegibilidad fina (categoría/sexo/estado).
  const hasAnimals = sync.animals().length > 0;
  // Solo lo que este rol puede escribir de verdad. Se OCULTA en vez de deshabilitar: un botón gris
  // sin explicación invita a tocarlo igual y a preguntar por qué no anda, y acá la respuesta —«tu
  // rol no lo permite»— no la puede dar la pantalla sin convertirse en un cartel de permisos.
  const acciones = ACTIONS.filter((a) => sync.puede(a.cap));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <View style={{ padding: T.space['4'], flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.space['4'] }}>
          <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Capturar</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={24} color={T.ink2} />
          </Pressable>
        </View>

        {hasAnimals ? (
          <>
            <Text style={{ fontSize: T.type.body, color: T.ink3, marginBottom: T.space['4'] }}>
              Todo se guarda en el dispositivo y se sube solo al sincronizar.
            </Text>
            <View style={styles.grid}>
              {acciones.map((a) => (
                <Pressable
                  key={a.tipo}
                  onPress={() => router.replace(a.href as any)}
                  style={({ pressed }) => [styles.action, pressed && { backgroundColor: T.brand100 }]}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={a.icon} size={24} color={T.brand700} />
                  </View>
                  <Text style={styles.actionLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <EmptyHerd />
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space['3'] },
  action: {
    width: '47%',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.borderSubtle,
    borderRadius: T.radiusMd,
    paddingVertical: T.space['5'],
    alignItems: 'center',
    gap: T.space['2.5'],
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.brand100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: T.type.input, fontWeight: '600', color: T.ink },
});
