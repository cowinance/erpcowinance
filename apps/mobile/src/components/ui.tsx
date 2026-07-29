import { Pressable, ScrollView, ScrollViewProps, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useStyles, useTheme, type Theme } from '@/useTheme';

/**
 * El scroll de una pantalla con formulario, que NO deja que el teclado tape lo que se escribe.
 *
 * **El problema.** En iOS el teclado cubre cerca del 40% de la pantalla y ninguna pantalla lo
 * manejaba. En una captura los campos van hacia el final y el botón «Guardar» está al fondo del
 * scroll: el productor escribía la dosis, el teclado le tapaba el botón, y tenía que cerrarlo a mano
 * para poder guardar. Con una mano en el celular y la otra en el animal, eso es un paso de más en
 * cada carga.
 *
 * **Cómo se resuelve.** `automaticallyAdjustKeyboardInsets` hace que el propio ScrollView corra su
 * contenido cuando el teclado aparece. Es de iOS y lo hace el sistema, así que se mueve con la misma
 * curva y la misma duración que el teclado — un `KeyboardAvoidingView` a mano queda siempre medio
 * paso atrás. En Android es un no-op y no hace falta: `adjustResize` ya redimensiona la ventana.
 *
 * `keyboardDismissMode="interactive"` es el gesto que un usuario de iPhone ya tiene en los dedos:
 * arrastrar hacia abajo para bajar el teclado, siguiendo el dedo. `keyboardShouldPersistTaps` deja
 * que el primer toque en un botón funcione con el teclado abierto, en vez de gastarse en cerrarlo.
 *
 * **Por qué un componente y no la prop en cada pantalla.** Son seis pantallas con campos hoy y las
 * que vengan después. Poner la prop seis veces es exactamente la forma en que la séptima se olvida —
 * y no es teoría: al hacer este arreglo la lista inicial tenía CINCO, y la sexta (tareas) apareció
 * recién al barrer todos los archivos con `TextInput`.
 *
 * Las LISTAS no pueden usar este componente —un `FlatList` no es un `ScrollView`— pero necesitan las
 * mismas props, así que se exportan aparte en `KEYBOARD_PROPS` y se comparten. Sin
 * `keyboardShouldPersistTaps`, en un buscador el primer toque sobre un resultado se gasta en cerrar
 * el teclado: se busca la caravana, se toca el animal, y no pasa nada.
 */
export const KEYBOARD_PROPS = {
  automaticallyAdjustKeyboardInsets: true,
  keyboardDismissMode: 'interactive',
  keyboardShouldPersistTaps: 'handled',
} as const;

export function FormScroll({ children, contentContainerStyle, ...rest }: ScrollViewProps & { children: React.ReactNode }) {
  return (
    <ScrollView {...KEYBOARD_PROPS} contentContainerStyle={contentContainerStyle} {...rest}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'warning' }) {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ flex: 1 }}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {hint ? (
        <Text style={[styles.kpiHint, tone === 'success' && { color: T.success }, tone === 'warning' && { color: T.warning }]}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && { backgroundColor: T.brand700 },
        variant === 'secondary' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.borderStrong },
        variant === 'danger' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.danger },
        (disabled || pressed) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'secondary' && { color: T.ink },
          variant === 'danger' && { color: T.danger },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SyncDot({ pending }: { pending: number }) {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space['1.5'] }}>
      <View style={[styles.dot, { backgroundColor: pending ? T.warning : T.success }]} />
      <Text style={{ fontSize: T.type.label, color: T.ink3 }}>{pending ? `${pending} pendiente${pending === 1 ? '' : 's'}` : 'Sincronizado'}</Text>
    </View>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.borderSubtle,
    padding: T.space['4'],
    // La misma altura que usa la tarjeta de la web (`--shadow-1`), desde los mismos números. Antes
    // el móvil no tenía ninguna: las tarjetas se apoyaban solo en el borde y todo quedaba en un
    // plano, que es de lo que más hace que una app se vea sin terminar.
    ...T.shadow('1'),
  },
  kpiLabel: { fontSize: T.type.label, color: T.ink2 },
  kpiValue: { fontSize: T.compat['26'], fontWeight: '700', color: T.ink, marginTop: T.space['1'], fontVariant: ['tabular-nums'] },
  kpiHint: { fontSize: T.type.caption, color: T.ink3, marginTop: T.space['0.5'] },
  btn: { height: 44, borderRadius: T.radiusSm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: T.space['4'] },
  btnText: { color: '#fff', fontSize: T.type.input, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
