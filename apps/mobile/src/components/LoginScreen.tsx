import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync } from '@/sync/SyncContext';
import { Button } from '@/components/ui';
import { T } from '@/theme';

export function LoginScreen() {
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return;
    setBusy(true);
    setError('');
    const err = await sync.login(email.trim().toLowerCase(), password);
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.box}>
        <View style={styles.logo}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>C</Text>
        </View>
        <Text style={styles.title}>Cowinance</Text>
        <Text style={styles.subtitle}>El sistema operativo de tu finca</Text>

        <View style={{ width: '100%', gap: 12, marginTop: 24 }}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={T.ink3}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Contraseña"
            placeholderTextColor={T.ink3}
            secureTextEntry
            style={styles.input}
          />
          {!!error && <Text style={{ fontSize: 12, color: T.danger }}>{error}</Text>}
          <Button label={busy ? 'Ingresando…' : 'Ingresar'} onPress={submit} disabled={busy || !email || !password} />
          <Text style={{ fontSize: 11, color: T.ink3, textAlign: 'center' }}>
            El primer ingreso descarga tu finca al dispositivo; después funciona sin señal.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.canvas, alignItems: 'center', justifyContent: 'center' },
  box: { width: '100%', maxWidth: 360, alignItems: 'center', paddingHorizontal: 24 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: T.brand700,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: T.ink },
  subtitle: { fontSize: 13, color: T.ink3, marginTop: 2 },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: T.radiusSm,
    paddingHorizontal: 14,
    fontSize: 15,
    color: T.ink,
    backgroundColor: T.surface,
  },
});
