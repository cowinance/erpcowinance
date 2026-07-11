import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync, API_URL } from '@/sync/SyncContext';
import { useAccount } from '@/account/AccountContext';
import { Button, Card } from '@/components/ui';
import { T } from '@/theme';

export default function Menu() {
  const sync = useSync();
  const account = useAccount();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  async function doResend() {
    if (resending) return;
    setResending(true);
    setResendMsg('');
    const result = await account.resendVerification();
    setResending(false);
    // Anti-enum: mensaje constante ante 'sent'; solo la red caída se distingue.
    setResendMsg(
      result === 'sent'
        ? 'Si tu email sigue sin verificar, te enviamos un nuevo enlace.'
        : 'No se pudo conectar. Probá de nuevo.',
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <Text style={{ fontSize: T.type.title, fontWeight: '700', color: T.ink }}>Menú</Text>

        <Card>
          <Text style={styles.title}>Usuario</Text>
          <Text style={styles.value}>{account.name ?? '—'}</Text>
          {account.email ? <Text style={styles.mono}>{account.email}</Text> : null}
          {account.role ? <Text style={[styles.value, { marginTop: T.space['0.5'] }]}>Rol: {account.role}</Text> : null}
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Finca</Text>
          <Text style={styles.value}>{sync.farmName ?? '—'}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>API</Text>
          <Text style={styles.mono}>{API_URL}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Último sync</Text>
          <Text style={styles.value}>{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('es-AR') : 'nunca'}</Text>
          <Text style={[styles.title, { marginTop: T.space['3'] }]}>Almacenamiento local</Text>
          <Text style={styles.value}>{sync.storageEngine}</Text>
        </Card>

        {account.emailVerified === false && (
          <Card>
            <Text style={styles.title}>Verificá tu email</Text>
            <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
              Te enviamos un enlace de verificación{account.email ? ` a ${account.email}` : ''}. El enlace se abre en la
              web, no dentro de la app. Podés seguir usando Cowinance mientras tanto.
            </Text>
            {resendMsg ? (
              <Text
                accessibilityRole={resendMsg.startsWith('No se pudo') ? 'alert' : 'text'}
                style={{ fontSize: T.type.label, marginBottom: T.space['2'], color: resendMsg.startsWith('No se pudo') ? T.danger : T.success }}
              >
                {resendMsg}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: T.space['2'] }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={resending ? 'Enviando…' : 'Reenviar email'}
                  variant="secondary"
                  onPress={doResend}
                  disabled={resending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={account.refreshing ? 'Actualizando…' : 'Ya verifiqué'}
                  onPress={() => account.refresh()}
                  disabled={account.refreshing}
                />
              </View>
            </View>
          </Card>
        )}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: T.space['3'] }}>
              <Text style={styles.title}>Simular sin señal</Text>
              <Text style={{ fontSize: T.type.label, color: T.ink3, marginTop: T.space['0.5'] }}>
                Bloquea el transporte para probar la captura offline; los registros quedan en cola.
              </Text>
            </View>
            <Switch
              value={sync.offlineSim}
              onValueChange={sync.setOfflineSim}
              trackColor={{ true: T.brand500, false: T.borderStrong }}
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.title}>Base local</Text>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
            Borra el snapshot local y vuelve a hidratar desde el servidor (requiere red).
          </Text>
          <Button
            label={confirmReset ? '¿Confirmar borrado local?' : 'Reiniciar base local'}
            variant="danger"
            onPress={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 3000);
              } else {
                sync.resetLocal();
              }
            }}
          />
        </Card>

        <Card>
          <Text style={styles.title}>Sesión</Text>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginVertical: T.space['2'] }}>
            Los datos locales se conservan; al volver a ingresar seguís donde estabas.
          </Text>
          <Button label="Cerrar sesión" variant="secondary" onPress={() => sync.logout()} />
        </Card>

        <Text style={{ fontSize: T.type.caption, color: T.ink3, textAlign: 'center' }}>Cowinance móvil · esqueleto v0.1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: T.type.body, fontWeight: '600', color: T.ink },
  value: { fontSize: 14, color: T.ink2, marginTop: T.space['0.5'] },
  mono: { fontFamily: 'monospace', fontSize: T.type.label, color: T.ink2, marginTop: T.space['0.5'] },
});
