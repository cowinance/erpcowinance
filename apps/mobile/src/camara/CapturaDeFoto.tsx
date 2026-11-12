import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as haptics from '@/lib/haptics';
import { PermisoDeCamara } from './PermisoDeCamara';

/**
 * Sacarle la foto a un animal.
 *
 * Hay una vista previa con «Usar esta / Repetir» antes de devolverla: una foto movida o del suelo
 * sube igual de lento que una buena, y en el campo la señal no sobra. La decisión se toma acá,
 * con la foto a la vista, no después de esperar la subida.
 */

export interface FotoTomada {
  uri: string;
  width: number;
  height: number;
}

interface Props {
  onTomada: (foto: FotoTomada) => void;
  onCerrar: () => void;
}

export function CapturaDeFoto({ onTomada, onCerrar }: Props) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const camara = useRef<CameraView>(null);
  const [lista, setLista] = useState(false);
  const [sacando, setSacando] = useState(false);
  const [previa, setPrevia] = useState<FotoTomada | null>(null);

  if (!permiso?.granted) {
    return (
      <PermisoDeCamara
        titulo="Sacarle una foto al animal"
        motivo="Cowinance usa la cámara para guardar la foto del animal en su ficha."
        etiquetaSalida="Volver"
        permiso={permiso}
        onPedir={pedirPermiso}
        onSalir={onCerrar}
      />
    );
  }

  async function sacar() {
    if (!lista || sacando) return;
    setSacando(true);
    try {
      const foto = await camara.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (foto?.uri) {
        haptics.tap();
        setPrevia({ uri: foto.uri, width: foto.width, height: foto.height });
      }
    } catch {
      /* si la cámara falla, se queda en la pantalla y se puede reintentar o salir */
    } finally {
      setSacando(false);
    }
  }

  if (previa) {
    return (
      <View style={estilos.fondo}>
        <View style={estilos.encabezado}>
          <Text style={estilos.encabezadoTexto}>¿Sirve esta foto?</Text>
        </View>
        {/* Lo que se ve es exactamente el archivo que se va a subir. */}
        <Image source={{ uri: previa.uri }} style={estilos.previa} contentFit="contain" />
        <View style={estilos.piePrevia}>
          <Pressable style={estilos.botonTenue} onPress={() => setPrevia(null)} accessibilityRole="button">
            <Text style={estilos.botonTenueTexto}>Repetir</Text>
          </Pressable>
          <Pressable
            style={[estilos.botonClaro, { flex: 1 }]}
            onPress={() => onTomada(previa)}
            accessibilityRole="button"
          >
            <Text style={estilos.botonClaroTexto}>Usar esta</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={estilos.fondo}>
      <CameraView
        ref={camara}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setLista(true)}
      />
      <View style={estilos.encabezado}>
        <Text style={estilos.encabezadoTexto}>Foto del animal</Text>
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel="Cerrar la cámara">
          <Text style={estilos.cerrar}>Cerrar</Text>
        </Pressable>
      </View>
      <View style={estilos.pie}>
        <Pressable
          onPress={sacar}
          disabled={!lista || sacando}
          style={[estilos.obturador, (!lista || sacando) && estilos.obturadorApagado]}
          accessibilityRole="button"
          accessibilityLabel="Sacar la foto"
        >
          {sacando ? <ActivityIndicator color="#000" /> : <View style={estilos.obturadorCentro} />}
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000' },
  encabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  encabezadoTexto: { color: '#fff', fontSize: 17, fontWeight: '600' },
  cerrar: { color: '#fff', fontSize: 16, paddingHorizontal: 8, paddingVertical: 8 },
  previa: { flex: 1, width: '100%' },
  piePrevia: { flexDirection: 'row', gap: 12, padding: 24, paddingBottom: 40 },
  pie: { marginTop: 'auto', alignItems: 'center', paddingBottom: 48, paddingTop: 24 },
  // Cuadrado: el gate de altos fijos lo permite porque no lleva texto que escale con el sistema.
  obturador: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  obturadorApagado: { opacity: 0.4 },
  obturadorCentro: { width: 62, height: 62, borderRadius: 31, borderWidth: 3, borderColor: '#000' },
  botonClaro: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  botonClaroTexto: { color: '#000', fontSize: 17, fontWeight: '700' },
  botonTenue: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  botonTenueTexto: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
