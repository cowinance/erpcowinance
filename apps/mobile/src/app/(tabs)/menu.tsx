import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync, API_URL } from '@/sync/SyncContext';
import { Button, Card } from '@/components/ui';
import { T } from '@/theme';

export default function Menu() {
  const sync = useSync();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: T.ink }}>Menú</Text>

        <Card>
          <Text style={styles.title}>Finca</Text>
          <Text style={styles.value}>{sync.farmName ?? '—'}</Text>
          <Text style={[styles.title, { marginTop: 12 }]}>API</Text>
          <Text style={styles.mono}>{API_URL}</Text>
          <Text style={[styles.title, { marginTop: 12 }]}>Último sync</Text>
          <Text style={styles.value}>{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('es-AR') : 'nunca'}</Text>
          <Text style={[styles.title, { marginTop: 12 }]}>Almacenamiento local</Text>
          <Text style={styles.value}>{sync.storageEngine}</Text>
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.title}>Simular sin señal</Text>
              <Text style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
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
          <Text style={{ fontSize: 12, color: T.ink3, marginVertical: 8 }}>
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

        <Text style={{ fontSize: 11, color: T.ink3, textAlign: 'center' }}>Cowinance móvil · esqueleto v0.1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 13, fontWeight: '600', color: T.ink },
  value: { fontSize: 14, color: T.ink2, marginTop: 2 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: T.ink2, marginTop: 2 },
});
