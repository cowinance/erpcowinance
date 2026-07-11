import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/theme';

export default function Mapa() {
  return (
    <SafeAreaView style={styles.center}>
      <View style={styles.iconWrap}>
        <Ionicons name="map-outline" size={26} color={T.brand700} />
      </View>
      <Text style={{ fontSize: T.type.heading, fontWeight: '600', color: T.ink }}>Potreros y Mapa</Text>
      <Text style={styles.body}>
        Tiles vectoriales offline, dibujo de potreros y posición GPS de animales llegan en la Fase 2 del roadmap.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.canvas, padding: T.space['8'] },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: T.radiusMd,
    backgroundColor: T.brand100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space['3'],
  },
  body: { fontSize: T.type.body, color: T.ink2, textAlign: 'center', marginTop: T.space['1.5'], lineHeight: 19 },
});
