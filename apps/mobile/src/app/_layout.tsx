import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SyncProvider } from '@/sync/SyncContext';
import { T } from '@/theme';

export default function RootLayout() {
  return (
    <SyncProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="manga" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="captura/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="captura/[tipo]" options={{ presentation: 'card' }} />
        <Stack.Screen name="animal/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="sincronizacion" options={{ presentation: 'card' }} />
      </Stack>
    </SyncProvider>
  );
}
