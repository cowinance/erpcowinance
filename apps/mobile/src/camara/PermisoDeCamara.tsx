import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PermissionResponse } from 'expo-camera';

/**
 * La pantalla previa a la cámara, compartida por el lector de caravana y la foto del animal.
 *
 * Dice para qué se usa la cámara —no «la app necesita permisos»— y **siempre ofrece la salida sin
 * cámara**: tecleando la caravana, o volviendo atrás. Un permiso denegado no puede dejar a nadie
 * sin poder trabajar; la cámara es un atajo.
 */
export function PermisoDeCamara({
  titulo,
  motivo,
  etiquetaSalida,
  permiso,
  onPedir,
  onSalir,
}: {
  titulo: string;
  /** Para qué se usa la cámara, en una frase que entienda quien está en el corral. */
  motivo: string;
  /** Qué dice el botón que sigue sin cámara: «Escribirla a mano», «Volver»… */
  etiquetaSalida: string;
  permiso: PermissionResponse | null;
  onPedir: () => void;
  onSalir: () => void;
}) {
  if (!permiso) {
    return (
      <View style={estilos.fondo}>
        <View style={estilos.centro}>
          <Text style={estilos.aviso}>Preparando la cámara…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={estilos.fondo}>
      <View style={estilos.centro}>
        <Text style={estilos.titulo}>{titulo}</Text>
        <Text style={estilos.aviso}>
          {permiso.canAskAgain
            ? motivo
            : 'El permiso de cámara está denegado. Se activa desde los ajustes del teléfono.'}
        </Text>
        {permiso.canAskAgain && (
          <Pressable style={estilos.botonClaro} onPress={onPedir} accessibilityRole="button">
            <Text style={estilos.botonClaroTexto}>Permitir cámara</Text>
          </Pressable>
        )}
        <Pressable style={estilos.botonTenue} onPress={onSalir} accessibilityRole="button">
          <Text style={estilos.botonTenueTexto}>{etiquetaSalida}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  titulo: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  aviso: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 22, textAlign: 'center' },
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
