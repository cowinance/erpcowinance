import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync, API_URL } from '@/sync/SyncContext';
import { FormScroll, Button } from '@/components/ui';
import { useStyles, useTheme, type Theme } from '@/useTheme';

type Mode = 'login' | 'forgot' | 'forgot-sent';

export function LoginScreen() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitLogin() {
    if (!email || !password) return;
    setBusy(true);
    setError('');
    const err = await sync.login(email.trim().toLowerCase(), password);
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function submitForgot() {
    if (!email || busy) return;
    setBusy(true);
    setError('');
    try {
      // Recuperación in-app: solo SOLICITA el enlace (el reset se hace en la web,
      // vía el enlace del correo). Anti-enum: cualquier respuesta → 'forgot-sent'.
      await fetch(`${API_URL}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setMode('forgot-sent');
    } catch {
      setError('Sin conexión con la API. Reintentá.');
    } finally {
      setBusy(false);
    }
  }

  function goLogin() {
    setMode('login');
    setError('');
  }

  return (
    <SafeAreaView style={styles.root}>
      {/*
        El formulario centrado también se lo come el teclado: en un iPhone chico, con el teclado
        abierto queda menos de la mitad de la pantalla y los campos de email y contraseña caen debajo.
        Es la PRIMERA pantalla de la app — la que ve alguien que todavía no confía en ella.

        Acá no sirve `automaticallyAdjustKeyboardInsets` porque no hay ScrollView que correr: el
        contenido está centrado con flex. `FormScroll` resuelve las dos cosas — deja el contenido
        centrado mientras entra, y lo vuelve desplazable cuando el teclado le come el alto.
      */}
      <FormScroll
        style={{ width: '100%' }}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.box}>
        <View style={styles.logo}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>C</Text>
        </View>
        <Text style={styles.title}>Cowinance</Text>
        <Text style={styles.subtitle}>El sistema operativo de tu finca</Text>

        {mode === 'login' && (
          <View style={{ width: '100%', gap: T.space['3'], marginTop: T.space['6'] }}>
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
              onSubmitEditing={submitLogin}
              placeholder="Contraseña"
              placeholderTextColor={T.ink3}
              secureTextEntry
              style={styles.input}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button label={busy ? 'Ingresando…' : 'Ingresar'} onPress={submitLogin} disabled={busy || !email || !password} />
            <Pressable onPress={() => { setMode('forgot'); setError(''); }} hitSlop={8}>
              <Text style={styles.link}>¿Olvidaste tu contraseña?</Text>
            </Pressable>
            <Text style={styles.hint}>El primer ingreso descarga tu finca al dispositivo; después funciona sin señal.</Text>
          </View>
        )}

        {mode === 'forgot' && (
          <View style={{ width: '100%', gap: T.space['3'], marginTop: T.space['6'] }}>
            <Text style={styles.hint}>Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña.</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={submitForgot}
              placeholder="Email"
              placeholderTextColor={T.ink3}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button label={busy ? 'Enviando…' : 'Enviar enlace'} onPress={submitForgot} disabled={busy || !email} />
            <Pressable onPress={goLogin} hitSlop={8}>
              <Text style={styles.link}>Volver a ingresar</Text>
            </Pressable>
          </View>
        )}

        {mode === 'forgot-sent' && (
          <View style={{ width: '100%', gap: T.space['3'], marginTop: T.space['6'] }}>
            <Text accessibilityRole="text" style={[styles.hint, { fontSize: T.type.body, color: T.ink2 }]}>
              Si existe una cuenta con ese email, te enviamos un enlace para restablecer tu contraseña. El enlace se abre
              en la web.
            </Text>
            <Button label="Volver a ingresar" variant="secondary" onPress={goLogin} />
          </View>
        )}
      </View>
      </FormScroll>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: T.canvas },
  // `flexGrow` y `justifyContent` en el CONTENEDOR del scroll: así el formulario queda centrado
  // mientras sobra alto, y se vuelve desplazable cuando el teclado lo reduce. Centrarlo en el
  // `root` lo dejaba clavado y el teclado le comía los campos.
  scrollBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  box: { width: '100%', maxWidth: 360, alignItems: 'center', paddingHorizontal: T.space['6'] },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: T.brand700,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space['3'],
  },
  title: { fontSize: T.compat['22'], fontWeight: '700', color: T.ink },
  subtitle: { fontSize: T.type.body, color: T.ink3, marginTop: T.space['0.5'] },
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
  error: { fontSize: T.type.label, color: T.danger },
  link: { fontSize: T.type.body, color: T.brand700, fontWeight: '600', textAlign: 'center', paddingVertical: T.space['1'] },
  hint: { fontSize: T.type.caption, color: T.ink3, textAlign: 'center' },
});
