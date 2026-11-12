/**
 * Potreros y mapa.
 *
 * Es un ESQUEMA, no un mapa con tiles: los potreros se dibujan en el mismo lienzo de 1000×700
 * unidades que usa el editor de la web, así que funciona sin señal y sin descargar nada. Esa fue
 * la decisión del editor y acá se respeta — dos mapas con geometrías distintas serían dos mapas.
 *
 * Lo que agrega el móvil es la pregunta del campo: «¿a qué potrero muevo este lote?». De ahí el
 * color por carga animal y el detalle al tocar, en vez de herramientas de dibujo.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polygon, Text as SvgText } from 'react-native-svg';
import { useSync } from '@/sync/SyncContext';
import { Card } from '@/components/ui';
import { aPuntos, centroide, viewBoxQueEncuadra } from '@/mapa/encuadre';
import { anilloDe, clasificarPorCarga, guardarPotreros, leerPotreros, type Carga, type Potrero } from '@/mapa/potreros';
import { useStyles, useTheme, type Theme } from '@/useTheme';

/** Un color por banda: con sol directo, un degradé no se lee de un vistazo. */
const COLOR: Record<Carga, string> = {
  'sin-datos': '#9aa8a2',
  uniforme: '#2e7d5b',
  menos: '#2e7d5b',
  medio: '#d97b2b',
  mas: '#b4452f',
};

/** Siempre comparativo: la app no dice qué carga es «buena», dice cuál de TUS potreros está peor. */
const ETIQUETA: Record<Carga, string> = {
  'sin-datos': 'Sin superficie cargada',
  uniforme: 'Igual que el resto',
  menos: 'De los más aliviados',
  medio: 'Carga intermedia',
  mas: 'De los más cargados',
};

export default function Mapa() {
  const T = useTheme();
  const styles = useStyles(makeStyles);
  const sync = useSync();
  const [potreros, setPotreros] = useState<Potrero[] | null>(null);
  const [bajadoEn, setBajadoEn] = useState<string | null>(null);
  const [desdeCache, setDesdeCache] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);

  const puedeVer = sync.puede('movimientos', 'read');

  const cargar = useCallback(async () => {
    if (!puedeVer) return;
    const cache = await leerPotreros();
    if (cache) {
      setPotreros(cache.potreros);
      setBajadoEn(cache.en);
      setDesdeCache(true);
    }
    if (sync.offlineSim) return;
    try {
      const r = await sync.authFetch('/paddocks');
      if (!r.ok) return;
      const frescos = (await r.json()) as Potrero[];
      const en = new Date().toISOString();
      setPotreros(frescos);
      setBajadoEn(en);
      setDesdeCache(false);
      await guardarPotreros(frescos, en);
    } catch {
      // Se queda con lo del caché, que ya está en pantalla y dice de cuándo es.
    }
  }, [puedeVer, sync]);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  // Si el potrero elegido dejó de existir en el refresco, el detalle no puede quedar colgado.
  useEffect(() => {
    if (elegido && !potreros?.some((p) => p.id === elegido)) setElegido(null);
  }, [elegido, potreros]);

  if (!puedeVer) {
    return (
      <SafeAreaView style={styles.centro}>
        <Ionicons name="lock-closed-outline" size={26} color={T.ink3} />
        <Text style={styles.vacioTitulo}>Sin acceso a potreros</Text>
        <Text style={styles.vacioCuerpo}>Tu rol no incluye movimientos de hacienda.</Text>
      </SafeAreaView>
    );
  }

  const dibujados = (potreros ?? []).filter((p) => anilloDe(p));
  // La escala se calcula sobre TODOS los potreros, no solo los dibujados: la comparación es del campo.
  const carga = clasificarPorCarga(potreros ?? []);
  const detalle = potreros?.find((p) => p.id === elegido) ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.canvas }}>
      <ScrollView contentContainerStyle={{ padding: T.space['4'], gap: T.space['3'] }}>
        <Text style={styles.titulo}>Potreros</Text>

        {potreros === null ? (
          <Text style={styles.vacioCuerpo}>Cargando…</Text>
        ) : dibujados.length === 0 ? (
          <Card>
            <Text style={styles.vacioTitulo}>Todavía no hay potreros dibujados</Text>
            <Text style={styles.vacioCuerpo}>
              {potreros.length > 0
                ? `Hay ${potreros.length} ${potreros.length === 1 ? 'potrero cargado' : 'potreros cargados'}, pero ninguno tiene su contorno. Se dibujan desde la web, en Potreros y Mapa.`
                : 'Se cargan desde la web, en Potreros y Mapa. Acá vas a poder ver cuál está más cargado y a cuál mover.'}
            </Text>
          </Card>
        ) : (
          <Card>
            <Svg viewBox={viewBoxQueEncuadra(dibujados.map((p) => anilloDe(p)!))} style={styles.lienzo}>
              {dibujados.map((p) => {
                const seleccionado = p.id === elegido;
                return (
                  <Polygon
                    key={p.id}
                    points={aPuntos(anilloDe(p)!)}
                    fill={COLOR[carga[p.id] ?? 'sin-datos']}
                    fillOpacity={seleccionado ? 0.85 : 0.45}
                    stroke={COLOR[carga[p.id] ?? 'sin-datos']}
                    strokeWidth={seleccionado ? 6 : 3}
                    onPress={() => setElegido(seleccionado ? null : p.id)}
                  />
                );
              })}
              {/* Los nombres van en una segunda pasada para que ningún potrero tape una etiqueta. */}
              {dibujados.map((p) => {
                const centro = centroide(anilloDe(p)!);
                if (!centro) return null;
                return (
                  <SvgText key={`t-${p.id}`} x={centro.x} y={centro.y} fontSize={22} fontWeight="700" fill="#0e2a20" textAnchor="middle">
                    {p.name}
                  </SvgText>
                );
              })}
            </Svg>
            <View style={styles.leyenda}>
              {(['menos', 'medio', 'mas'] as const).map((c) => (
                <View key={c} style={styles.leyendaItem}>
                  <View style={[styles.punto, { backgroundColor: COLOR[c] }]} />
                  <Text style={styles.leyendaTexto}>{ETIQUETA[c]}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.tenue}>
              {desdeCache && bajadoEn
                ? `Sin conexión — datos del ${new Date(bajadoEn).toLocaleString('es-AR')}`
                : 'Tocá un potrero para ver su detalle.'}
            </Text>
          </Card>
        )}

        {detalle && (
          <Card>
            <Text style={styles.detalleTitulo}>{detalle.name}</Text>
            <Text style={styles.tenue}>
              {detalle.area_ha != null ? `${detalle.area_ha} ha` : 'Sin superficie'} · {detalle.animal_count}{' '}
              {detalle.animal_count === 1 ? 'animal' : 'animales'}
              {detalle.stocking_rate != null ? ` · ${detalle.stocking_rate} an/ha` : ''}
            </Text>
            <Text style={[styles.tenue, { color: COLOR[carga[detalle.id] ?? 'sin-datos'] }]}>{ETIQUETA[carga[detalle.id] ?? 'sin-datos']}</Text>
            {detalle.lots.length === 0 ? (
              <Text style={styles.vacioCuerpo}>No hay lotes en este potrero.</Text>
            ) : (
              detalle.lots.map((l) => (
                <View key={l.id} style={styles.filaLote}>
                  <Text style={styles.loteNombre}>{l.name}</Text>
                  <Text style={styles.tenue}>
                    {l.animal_count} {l.animal_count === 1 ? 'animal' : 'animales'}
                  </Text>
                </View>
              ))
            )}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.canvas, padding: T.space['8'], gap: T.space['2'] },
    titulo: { fontSize: T.type.title, fontWeight: '700', color: T.ink },
    detalleTitulo: { fontSize: T.type.subheading, fontWeight: '700', color: T.ink, marginBottom: T.space['1'] },
    vacioTitulo: { fontSize: T.type.heading, fontWeight: '600', color: T.ink, textAlign: 'center' },
    vacioCuerpo: { fontSize: T.type.body, color: T.ink2, marginTop: T.space['1.5'], lineHeight: 19 },
    tenue: { fontSize: T.type.caption, color: T.ink3, marginTop: T.space['1'] },
    // El lienzo es 1000×700: la proporción se fija acá y el viewBox hace el encuadre.
    lienzo: { width: '100%', aspectRatio: 1000 / 700 },
    leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space['3'], marginTop: T.space['2.5'] },
    leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: T.space['1'] },
    punto: { width: 10, height: 10, borderRadius: 5 },
    leyendaTexto: { fontSize: T.type.caption, color: T.ink2 },
    filaLote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: T.space['1.5'],
      borderTopWidth: 1,
      borderTopColor: T.borderSubtle,
      marginTop: T.space['1.5'],
    },
    loteNombre: { fontSize: T.type.body, color: T.ink, fontWeight: '600' },
  });
