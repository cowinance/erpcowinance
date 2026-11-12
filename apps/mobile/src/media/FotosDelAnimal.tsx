import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, useSync } from '@/sync/SyncContext';
import { Card } from '@/components/ui';
import { CapturaDeFoto } from '@/camara/CapturaDeFoto';
import { useStyles, useTheme, type Theme } from '@/useTheme';
import { describirTamano, motivoParaNoSubir } from './foto-reglas';
import { prepararFoto } from './preparar-foto';

/**
 * Fotos del animal, contra el módulo `media` de la API — que estaba construido y sin usar.
 *
 * **Las fotos NO van por el motor de sincronización, y eso se dice en pantalla.** El motor mueve
 * filas y eventos, no archivos: meter una foto de 300 KB en un changeset cambiaría el protocolo y
 * el tamaño de la cola. Entonces una foto se sube en el momento o no se sube, y la persona tiene
 * que saberlo ANTES de sacarla — no descubrirlo cuando vuelve al casco y la foto no está.
 */

interface FotoRemota {
  attachment_id: string;
  file_id: string;
  token: string;
  mime: string;
  is_primary: boolean;
  caption: string | null;
}

const urlDeFoto = (f: FotoRemota) => `${API_URL}/files/${f.file_id}/content?t=${encodeURIComponent(f.token)}`;

export function FotosDelAnimal({ animalId }: { animalId: string }) {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [fotos, setFotos] = useState<FotoRemota[] | null>(null);
  const [sacando, setSacando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState('');

  const puedeVer = sync.puede('hato', 'read');
  const puedeSubir = sync.puede('hato', 'write');

  const cargar = useCallback(async () => {
    if (!puedeVer) return;
    try {
      const r = await sync.authFetch(`/animals/${animalId}/photos`);
      if (r.ok) setFotos(await r.json());
      else setFotos([]);
    } catch {
      // Sin señal no hay fotos que mostrar; no es un error que haya que gritar.
      setFotos([]);
    }
  }, [animalId, puedeVer, sync]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function subir(uri: string, ancho: number, alto: number) {
    setSacando(false);
    setSubiendo(true);
    setAviso('');
    try {
      const lista = await prepararFoto(uri, ancho, alto);
      const motivo = motivoParaNoSubir(lista.dataUrl);
      if (motivo) {
        setAviso(motivo);
        return;
      }
      const r = await sync.authFetch(`/animals/${animalId}/photos`, {
        method: 'POST',
        body: JSON.stringify({ data_url: lista.dataUrl, taken_at: new Date().toISOString() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setAviso(j?.message?.title ?? j?.title ?? 'No se pudo subir la foto.');
        return;
      }
      setAviso(`Foto subida (${describirTamano(lista.bytes)}).`);
      await cargar();
    } catch {
      setAviso('No se pudo subir: la foto necesita conexión y no viaja en la cola de sincronización.');
    } finally {
      setSubiendo(false);
    }
  }

  if (!puedeVer) return null;

  if (sacando) {
    return <CapturaDeFoto onTomada={(f) => subir(f.uri, f.width, f.height)} onCerrar={() => setSacando(false)} />;
  }

  return (
    <Card>
      <Text style={styles.titulo}>Fotos {fotos ? `(${fotos.length})` : ''}</Text>

      {fotos === null ? (
        <Text style={styles.tenue}>Cargando…</Text>
      ) : fotos.length === 0 ? (
        <Text style={styles.tenue}>Todavía no tiene fotos.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: T.space['2'] }}>
          {fotos.map((f) => (
            <View key={f.attachment_id}>
              <Image source={{ uri: urlDeFoto(f) }} style={styles.miniatura} contentFit="cover" transition={150} />
              {f.is_primary && (
                <View style={styles.principal}>
                  <Ionicons name="star" size={11} color="#fff" />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {puedeSubir && (
        <>
          <Pressable
            onPress={() => setSacando(true)}
            disabled={subiendo || sync.offlineSim}
            style={[styles.boton, (subiendo || sync.offlineSim) && { opacity: 0.4 }]}
            accessibilityRole="button"
          >
            {subiendo ? (
              <ActivityIndicator color={T.brand700} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={18} color={T.brand700} />
                <Text style={styles.botonTexto}>Sacar foto</Text>
              </>
            )}
          </Pressable>
          {/* Dicho antes de sacarla, no después de que falle. */}
          <Text style={styles.tenue}>
            {sync.offlineSim
              ? 'Sin señal no se pueden subir fotos: no viajan en la cola de sincronización.'
              : 'Las fotos se suben en el momento; no quedan en la cola si no hay señal.'}
          </Text>
        </>
      )}

      {!!aviso && <Text style={styles.aviso}>{aviso}</Text>}
    </Card>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    titulo: { fontSize: T.type.subheading, fontWeight: '600', color: T.ink, marginBottom: T.space['2'] },
    tenue: { fontSize: T.type.caption, color: T.ink3, marginTop: T.space['1.5'] },
    aviso: { fontSize: T.type.caption, color: T.ink2, marginTop: T.space['1.5'] },
    // Cuadrado: sin texto que escale, el alto fijo es lo correcto para una miniatura.
    miniatura: { width: 92, height: 92, borderRadius: T.radiusSm, backgroundColor: T.borderSubtle },
    principal: {
      position: 'absolute',
      top: 6,
      left: 6,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 8,
      paddingHorizontal: 5,
      paddingVertical: 3,
    },
    boton: {
      minHeight: 48,
      marginTop: T.space['2.5'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: T.space['1.5'],
      borderRadius: T.radiusSm,
      borderWidth: 1,
      borderColor: T.borderStrong,
    },
    botonTexto: { fontSize: T.type.body, fontWeight: '600', color: T.brand700 },
  });
