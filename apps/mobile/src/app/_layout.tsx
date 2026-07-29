import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SyncProvider, useSync } from '@/sync/SyncContext';
import { AccountProvider } from '@/account/AccountContext';
import { LoginScreen } from '@/components/LoginScreen';
import { PushBridge } from '@/push/PushBridge';
import { useTheme } from '@/useTheme';

function Gate() {
  const sync = useSync();
  const T = useTheme();
  if (sync.status === 'login') return <LoginScreen />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.canvas } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="manga" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="captura/index" options={{ presentation: 'modal' }} />
      <Stack.Screen name="captura/[tipo]" options={{ presentation: 'card' }} />
      <Stack.Screen name="animal/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="sincronizacion" options={{ presentation: 'card' }} />
      <Stack.Screen name="tareas" options={{ presentation: 'card' }} />
      <Stack.Screen name="notificaciones" options={{ presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SyncProvider>
      <AccountProvider>
        {/*
          `auto` y no `dark`: la barra de estado tiene que invertirse con el sistema. Estaba fija en
          oscuro, así que en modo oscuro los iconos negros quedaban sobre un fondo negro —
          invisibles.
        */}
        <StatusBar style="auto" />
        <PushBridge />
        <Gate />
      </AccountProvider>
    </SyncProvider>
  );
}
