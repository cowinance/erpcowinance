/**
 * Tab bar inferior de 5 posiciones (doc diseño §3.2):
 * Inicio · Animales · botón central de captura (+) elevado · Mapa · Menú
 */
import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/sync/SyncContext';
import { T } from '@/theme';

function CaptureButton() {
  return (
    <Pressable
      onPress={() => router.push('/captura')}
      style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.95 }] }]}
      accessibilityLabel="Capturar"
    >
      <Ionicons name="add" size={30} color="#fff" />
    </Pressable>
  );
}

export default function TabsLayout() {
  const unread = useSync().unreadNotifications(); // fuente única del contador (P7-4.c)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.brand700,
        tabBarInactiveTintColor: T.ink3,
        tabBarStyle: { backgroundColor: T.surface, borderTopColor: T.borderSubtle, height: 64, paddingTop: T.space['1.5'] },
        tabBarLabelStyle: { fontSize: T.type.caption, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Inicio', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="animales"
        options={{ title: 'Animales', tabBarIcon: ({ color, size }) => <Ionicons name="paw-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="capturar"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={styles.fabWrap}>
              <CaptureButton />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="mapa"
        options={{ title: 'Mapa', tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menú',
          tabBarIcon: ({ color, size }) => <Ionicons name="menu-outline" size={size} color={color} />,
          // Badge de no leídas (P7-4.c.2): tabBarBadge admite string|number (RN bottom-tabs, SDK 57).
          // El visual satura en '99+'; el label accesible comunica SIEMPRE la cantidad real.
          tabBarBadge: unread === 0 ? undefined : unread > 99 ? '99+' : unread,
          tabBarBadgeStyle: { backgroundColor: T.warning, color: '#fff' },
          tabBarAccessibilityLabel: unread === 0 ? 'Menú' : `Menú, ${unread} notificaciones no leídas`,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: -22,
    backgroundColor: T.brand700,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
