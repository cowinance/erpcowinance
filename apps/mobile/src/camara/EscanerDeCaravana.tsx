import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as haptics from '@/lib/haptics';
import { PermisoDeCamara } from './PermisoDeCamara';
import { TIPOS_DE_CODIGO, aceptarLectura, normalizarCodigo } from './lectura';

/**
 * Lector de caravana por cámara.
 *
 * **Nada de lo que se lee se aplica solo.** Entre el escaneo y la acción hay siempre una
 * confirmación que muestra QUÉ animal es, no solo el número: equivocarse de animal —vacunar al
 * que no era, dar por muerto al que no era— es peor que teclear. El teclado sigue estando atrás
 * de este modal, y cerrar es volver a él.
 *
 * Quien abre el lector decide qué significa el código: `resolver` recibe lo leído y devuelve el
 * texto de la confirmación y si se puede confirmar. En la manga «no existe» bloquea; en el alta
 * rápida «no existe» es justamente lo que se busca.
 */

export interface Resolucion {
  /** Línea principal de la confirmación. Normalmente el animal; si no, el código. */
  titulo: string;
  detalle?: string;
  /** `false` deja ver lo leído pero no permite seguir. */
  confirmable: boolean;
}

interface Props {
  encabezado?: string;
  resolver: (codigo: string) => Resolucion;
  onConfirmar: (codigo: string) => void;
  onCerrar: () => void;
}

export function EscanerDeCaravana({ encabezado = 'Leer caravana', resolver, onConfirmar, onCerrar }: Props) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [leido, setLeido] = useState<string | null>(null);
  // La cámara dispara la lectura muchas veces por segundo; el ref frena antes de que React
  // alcance a re-renderizar, que es demasiado tarde.
  const ultima = useRef<{ codigo: string; en: number } | null>(null);
  const congelado = useRef(false);

  const alEscanear = useCallback(
    ({ data }: { data: string }) => {
      if (congelado.current) return;
      const codigo = normalizarCodigo(data);
      if (!codigo) return;
      if (!aceptarLectura(codigo, ultima.current, Date.now())) return;
      ultima.current = { codigo, en: Date.now() };
      congelado.current = true;
      haptics.tap();
      setLeido(codigo);
    },
    [],
  );

  const volverAEscanear = () => {
    setLeido(null);
    congelado.current = false;
  };

  if (!permiso?.granted) {
    return (
      <PermisoDeCamara
        titulo="Leer la caravana con la cámara"
        motivo="Cowinance usa la cámara para leer el código de la caravana. Podés seguir tecleándola si preferís."
        etiquetaSalida="Escribirla a mano"
        permiso={permiso}
        onPedir={pedirPermiso}
        onSalir={onCerrar}
      />
    );
  }

  const resolucion = leido ? resolver(leido) : null;

  return (
    <View style={estilos.fondo}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...TIPOS_DE_CODIGO] }}
        onBarcodeScanned={leido ? undefined : alEscanear}
      />

      <View style={estilos.encabezado}>
        <Text style={estilos.encabezadoTexto}>{encabezado}</Text>
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel="Cerrar el lector">
          <Text style={estilos.cerrar}>Cerrar</Text>
        </Pressable>
      </View>

      {!leido && (
        <View style={estilos.centro} pointerEvents="none">
          <View style={estilos.mira} />
          <Text style={estilos.pista}>Apuntá al código de la caravana</Text>
        </View>
      )}

      {leido && resolucion && (
        <View style={estilos.confirmacion}>
          <Text style={estilos.codigo}>{leido}</Text>
          <Text style={estilos.confirmacionTitulo}>{resolucion.titulo}</Text>
          {!!resolucion.detalle && <Text style={estilos.confirmacionDetalle}>{resolucion.detalle}</Text>}
          <View style={estilos.botonera}>
            <Pressable style={estilos.botonTenue} onPress={volverAEscanear} accessibilityRole="button">
              <Text style={estilos.botonTenueTexto}>Volver a escanear</Text>
            </Pressable>
            <Pressable
              style={[estilos.botonClaro, estilos.botonAncho, !resolucion.confirmable && estilos.botonApagado]}
              disabled={!resolucion.confirmable}
              onPress={() => onConfirmar(leido)}
              accessibilityRole="button"
            >
              <Text style={estilos.botonClaroTexto}>Es este</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Colores a mano y no del tema, igual que la manga: esto se dibuja ENCIMA del video de la cámara,
 * donde el fondo es el corral. El contraste tiene que ser máximo con sol directo, y eso no lo da
 * una paleta pensada para una pantalla de formulario.
 */
const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  titulo: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  aviso: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 22, textAlign: 'center' },
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
  mira: {
    width: '78%',
    aspectRatio: 1.9,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
  },
  pista: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  confirmacion: {
    marginTop: 'auto',
    backgroundColor: 'rgba(0,0,0,0.88)',
    padding: 24,
    paddingBottom: 40,
    gap: 6,
  },
  codigo: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'monospace', letterSpacing: 1 },
  confirmacionTitulo: { color: '#fff', fontSize: 24, fontWeight: '700' },
  confirmacionDetalle: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21 },
  botonera: { flexDirection: 'row', gap: 12, marginTop: 18 },
  botonClaro: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  botonAncho: { flex: 1 },
  botonApagado: { opacity: 0.35 },
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
