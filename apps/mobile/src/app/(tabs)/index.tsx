import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSync } from '@/sync/SyncContext';
import { useAccount } from '@/account/AccountContext';
import { Button, Card, Kpi, SyncDot } from '@/components/ui';
import { EmptyHerd } from '@/components/EmptyHerd';
import { T } from '@/theme';

export default function Home() {
  const sync = useSync();
  const account = useAccount();
  // Nombre real de /auth/me (o meta persistida); saludo neutral si aún no hay dato.
  const firstName = account.name?.split(' ')[0];

  if (sync.status === 'boot') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: T.ink2 }}>Preparando la base local…</Text>
      </SafeAreaView>
    );
  }
  if (sync.status === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ fontSize: T.compat['16'], fontWeight: '600', color: T.ink }}>No se pudo inicializar</Text>
        <Text style={{ color: T.ink2, marginTop: T.space['1.5'], textAlign: 'center', paddingHorizontal: T.space['8'] }}>
          El primer arranque necesita la API ({sync.errorMsg}). Después, la app funciona 100% offline.
        </Text>
        <View style={{ marginTop: T.space['4'], width: 200 }}>
          <Button label="Reintentar" onPress={() => sync.resetLocal()} />
        </View>
      </SafeAreaView>
    );
  }

  const animals = sync.animals();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buen día' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  async function doSync() {
    await sync.syncNow();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Text style={styles.h1}>{firstName ? `${greeting}, ${firstName}` : greeting}</Text>
            <Text style={{ fontSize: T.type.body, color: T.ink3, marginTop: T.space['0.5'] }}>{sync.farmName ?? 'Cowinance'}</Text>
          </View>
          <SyncDot pending={sync.pendingCount} />
        </View>

        {sync.offlineSim && (
          <View style={styles.offlineBanner}>
            <Text style={{ color: '#fff', fontSize: T.type.body, fontWeight: '600' }}>
              Sin conexión (simulada) — {sync.pendingCount} {sync.pendingCount === 1 ? 'registro pendiente' : 'registros pendientes'} de subir
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: T.space['3'] }}>
          <Kpi label="Animales activos" value={String(animals.length)} hint="en la base local" />
          <Kpi
            label="Pendientes de subir"
            value={String(sync.pendingCount)}
            hint={sync.pendingCount ? 'esperando sincronización' : 'todo al día'}
            tone={sync.pendingCount ? 'warning' : 'success'}
          />
        </View>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.space['1'] }}>
            <Text style={styles.cardTitle}>Sincronización</Text>
            <Text style={{ fontSize: T.type.label, color: T.brand700, fontWeight: '600' }} onPress={() => router.push('/sincronizacion')}>
              Ver detalle →
            </Text>
          </View>
          <Text style={{ fontSize: T.type.label, color: T.ink3, marginBottom: T.space['3'] }}>
            Automática (al capturar y cada 60 s) · último sync:{' '}
            {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleTimeString('es-AR') : 'nunca'}
          </Text>
          <Button label={sync.syncing ? 'Sincronizando…' : 'Sincronizar ahora'} onPress={doSync} disabled={sync.syncing} />
          {sync.lastSyncResult ? (
            <Text
              style={{ fontSize: T.type.label, marginTop: T.space['2'], color: sync.lastSyncResult.startsWith('Sync OK') ? T.success : T.warning }}
            >
              {sync.lastSyncResult}
            </Text>
          ) : null}
        </Card>

        {animals.length === 0 ? (
          // Sin animales en el dispositivo: no ofrecer capturas que requieren un
          // animal (manga = pesaje). Guía para cargar el primero desde la web.
          <Card>
            <EmptyHerd />
          </Card>
        ) : (
          <Card>
            <Text style={styles.cardTitle}>Captura de campo</Text>
            <Text style={{ fontSize: T.type.label, color: T.ink3, marginBottom: T.space['3'] }}>
              Pesajes con caravana, offline, en menos de 3 toques.
            </Text>
            <Button label="Abrir modo manga" onPress={() => router.push('/manga')} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.canvas },
  h1: { fontSize: T.type.title, fontWeight: '700', color: T.ink },
  cardTitle: { fontSize: T.type.subheading, fontWeight: '600', color: T.ink, marginBottom: T.space['1'] },
  offlineBanner: { backgroundColor: T.warning, borderRadius: T.radiusSm, paddingVertical: T.space['2'], paddingHorizontal: T.space['3'] },
});
