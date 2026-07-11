import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { T } from '@/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' | 'warning' }) {
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[styles.dot, { backgroundColor: pending ? T.warning : T.success }]} />
      <Text style={{ fontSize: 12, color: T.ink3 }}>{pending ? `${pending} pendiente${pending === 1 ? '' : 's'}` : 'Sincronizado'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.borderSubtle,
    padding: 16,
  },
  kpiLabel: { fontSize: T.type.label, color: T.ink2 },
  kpiValue: { fontSize: T.compat['26'], fontWeight: '700', color: T.ink, marginTop: 4, fontVariant: ['tabular-nums'] },
  kpiHint: { fontSize: T.type.caption, color: T.ink3, marginTop: 2 },
  btn: { height: 44, borderRadius: T.radiusSm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
