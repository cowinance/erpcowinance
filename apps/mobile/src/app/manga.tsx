/**
 * Modo manga nativo — estación de captura de campo con SESIÓN y MODOS (auditoría Fase 2, paridad
 * con la web). 100% OFFLINE: busca el animal en la base local por caravana y guarda cada acción
 * como changeset local que sube al sincronizar. Alto contraste, targets 56px+, feedback háptico.
 *
 * Paridad con /manga web: sesión (nombre/lote objetivo/contadores/últimos registros/resumen),
 * 7 modos (Pesaje default · Revisión · Nota · Tratamiento · Vacunación · Movimiento · Reproducción)
 * y la MISMA regla de validación de peso (`validateWeighing` de @cowinance/domain) — sin duplicar.
 * Cada modo delega en la captura offline que ya existía (captureWeighing/Note/Treatment/Vaccination/
 * Movement/Heat/Service/Diagnosis), así que el contrato de sync no cambia.
 */
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { mangaCardAlerts, type MangaAlert } from '@cowinance/domain';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { FormScroll } from '@/components/ui';
import { EscanerDeCaravana } from '@/camara/EscanerDeCaravana';
import { ModeCapture } from '@/components/manga/ModeCapture';
import { AMBER, GREEN, RED, styles, type Mode } from '@/components/manga/estilos';
import { diasDesde, useAhora } from '@/lib/ahora';
import * as haptics from '@/lib/haptics';

const SCAN_DEBOUNCE_MS = 1500;

/**
 * Cada modo con la capacidad que hace falta para GUARDARLO.
 *
 * La pantalla de captura ya filtraba por rol, pero esta —que es la que más se usa en el corral— no,
 * y ofrecía los siete a todo el mundo. Comprobado con un veterinario, que tiene `pesajes` en modo
 * lectura: entraba a una sesión de Pesaje sin obstáculo. El servidor rechazaba el push igual (el
 * canal de sync valida capacidad), pero eso es justo lo peor: el trabajo se guarda en el teléfono y
 * el rechazo aparece al volver la señal, con la manga ya levantada.
 *
 * Revisión y Nota van bajo `hato`: son observaciones sobre el animal, no un acto clínico. Es la
 * misma capacidad con la que se edita su ficha.
 */
const MODE_CAP: Record<Mode, string> = {
  Pesaje: 'pesajes',
  Revisión: 'hato',
  Nota: 'hato',
  Tratamiento: 'sanidad.aplicar',
  Vacunación: 'sanidad.aplicar',
  Movimiento: 'movimientos',
  Reproducción: 'reproduccion',
};
const MODES: Mode[] = ['Pesaje', 'Revisión', 'Nota', 'Tratamiento', 'Vacunación', 'Movimiento', 'Reproducción'];

interface SessionRecord {
  key: string;
  tag: string;
  action: string;
  detail: string;
  at: number;
}

const clock = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export default function Manga() {
  const sync = useSync();

  /**
   * Los modos que ESTE rol puede guardar. Se calcula una vez: la matriz llega en el bootstrap y no
   * cambia mientras dure la sesión.
   *
   * El default deja de ser «Pesaje» fijo y pasa a ser el primero permitido — para un veterinario,
   * que no pesa, arrancar en un modo que no puede usar sería la misma promesa rota, solo que en la
   * primera pantalla.
   */
  const modosPermitidos = useMemo(() => MODES.filter((m) => sync.puede(MODE_CAP[m], 'write')), [sync]);

  const [phase, setPhase] = useState<'setup' | 'capture' | 'summary'>('setup');
  const [mode, setMode] = useState<Mode>(modosPermitidos[0] ?? 'Pesaje');
  const [sessionName, setSessionName] = useState('');
  const [targetLot, setTargetLot] = useState<{ id: string; name: string } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  /** Instante en que se cerró la sesión. El resumen no puede seguir contando mientras se mira. */
  const [endedAt, setEndedAt] = useState(0);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [errors, setErrors] = useState(0);

  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const tagRef = useRef<TextInput>(null);
  const lastScan = useRef<{ v: string; at: number }>({ v: '', at: 0 });
  const [escaneando, setEscaneando] = useState(false);

  const lots = sync.lots();
  const vaccines = sync.products('vaccine');
  const meds = sync.products('other');
  const bulls = useMemo(() => sync.animals().filter((a) => (a.category ?? '').toLowerCase().includes('toro')), [sync]);

  const focusTag = () => setTimeout(() => tagRef.current?.focus(), 80);
  const fail = (msg: string) => {
    setError(msg);
    setErrors((e) => e + 1);
    haptics.error();
  };
  const pushRecord = (action: string, detail: string) => {
    if (!animal) return;
    setRecords((r) => [{ key: `${Date.now()}-${Math.random()}`, tag: animal.tag ?? '—', action, detail, at: Date.now() }, ...r]);
    haptics.ok();
    setAnimal(null);
    setError('');
    setWarn(null);
    setConfirmMsg(null);
    focusTag();
  };

  function lookup() {
    const id = tag.trim();
    if (!id) return;
    // Anti-rebote del lector: mismo identificador re-escaneado enseguida → se ignora.
    const now = Date.now();
    if (lastScan.current.v === id.toUpperCase() && now - lastScan.current.at < SCAN_DEBOUNCE_MS) {
      setTag('');
      return;
    }
    lastScan.current = { v: id.toUpperCase(), at: now };
    setError('');
    const found = sync.findByTag(id);
    if (!found) {
      fail(`SIN ANIMAL ${id.toUpperCase()}`);
      return;
    }
    setAnimal(found);
    setTag('');
    haptics.tap();
  }

  const saved = records.length;
  const mins = Math.max(1, Math.round(((endedAt || startedAt) - startedAt) / 60000));

  /**
   * Un rol sin ninguna captura —el contador— no entra a la manga.
   *
   * Sin esto vería la lista de modos vacía y un EMPEZAR que arranca una sesión donde no puede
   * guardar nada. Acá SÍ se explica el motivo, al revés que en la pantalla de captura, donde las
   * acciones simplemente no aparecen: allá el rol se lleva algunas y quedan otras, y un cartel
   * sobraría; acá se lleva la pantalla entera, y una pantalla en blanco sin decir por qué se lee
   * como una falla de la app.
   */
  if (modosPermitidos.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={[styles.setupBody, { justifyContent: 'center', flex: 1 }]}>
          <Text style={styles.kicker}>MODO MANGA</Text>
          <Text style={styles.setupTitle}>No disponible para tu rol</Text>
          <Text style={[styles.link, { textAlign: 'left', opacity: 0.7 }]}>
            La manga registra trabajo de campo —pesajes, sanidad, movimientos— y tu rol no captura ninguno.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.link}>Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Setup ──
  if (phase === 'setup') {
    return (
      <SafeAreaView style={styles.root}>
        <FormScroll contentContainerStyle={styles.setupBody}>
          <Text style={styles.kicker}>MODO MANGA</Text>
          <Text style={styles.setupTitle}>Nueva sesión de trabajo</Text>

          <Text style={styles.fieldLabel}>NOMBRE (OPCIONAL)</Text>
          <TextInput
            value={sessionName}
            onChangeText={setSessionName}
            placeholder="Ej. Pesada recría"
            placeholderTextColor="rgba(255,255,255,0.25)"
            style={styles.setupInput}
          />

          <Text style={styles.fieldLabel}>LOTE OBJETIVO (OPCIONAL)</Text>
          <View style={styles.wrapRow}>
            <Pressable accessibilityRole="button" onPress={() => setTargetLot(null)} style={[styles.pill, !targetLot && styles.pillOn]}>
              <Text style={[styles.pillText, !targetLot && styles.pillTextOn]}>Todos</Text>
            </Pressable>
            {lots.slice(0, 8).map((l) => {
              const on = targetLot?.id === l.id;
              return (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={l.id} onPress={() => setTargetLot({ id: l.id, name: l.name })} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{l.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>MODO</Text>
          <View style={styles.wrapRow}>
            {modosPermitidos.map((m) => {
              const on = mode === m;
              return (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={m} onPress={() => setMode(m)} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{m}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setStartedAt(Date.now());
              setEndedAt(0);
              setRecords([]);
              setErrors(0);
              setPhase('capture');
              focusTag();
            }}
            style={[styles.bigBtn, { backgroundColor: '#fff' }]}
          >
            <Text style={[styles.bigBtnText, { color: '#000' }]}>EMPEZAR</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.link}>Cancelar</Text>
          </Pressable>
        </FormScroll>
      </SafeAreaView>
    );
  }

  // ── Resumen ──
  if (phase === 'summary') {
    const byAction = records.reduce<Record<string, number>>((acc, r) => ((acc[r.action] = (acc[r.action] ?? 0) + 1), acc), {});
    return (
      <SafeAreaView style={styles.root}>
        <FormScroll contentContainerStyle={styles.setupBody}>
          <Text style={styles.kicker}>RESUMEN DE SESIÓN</Text>
          {!!sessionName && <Text style={styles.setupTitle}>{sessionName}</Text>}
          <Text style={styles.muted}>
            {targetLot ? `${targetLot.name} · ` : ''}{mins} min · desde {clock(startedAt)}
          </Text>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: GREEN }]}>{saved}</Text>
              <Text style={styles.statLabel}>Procesados</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: errors ? RED : '#fff' }]}>{errors}</Text>
              <Text style={styles.statLabel}>Errores</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: sync.pendingCount ? AMBER : '#fff' }]}>{sync.pendingCount}</Text>
              <Text style={styles.statLabel}>Por subir</Text>
            </View>
          </View>

          {Object.keys(byAction).length > 0 && (
            <View style={styles.wrapRow}>
              {Object.entries(byAction).map(([a, n]) => (
                <View key={a} style={styles.pill}>
                  <Text style={styles.pillText}>{a}: {n}</Text>
                </View>
              ))}
            </View>
          )}

          {records.slice(0, 20).map((r) => (
            <View key={r.key} style={styles.recRow}>
              <Text style={styles.recTag}>{r.tag}</Text>
              <Text style={styles.recDetail} numberOfLines={1}>{r.action} · {r.detail}</Text>
              <Text style={styles.recTime}>{clock(r.at)}</Text>
            </View>
          ))}

          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <Pressable accessibilityRole="button" onPress={() => setPhase('setup')} style={[styles.bigBtn, { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <Text style={[styles.bigBtnText, { color: '#fff', fontSize: 17 }]}>Nueva sesión</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={[styles.bigBtn, { flex: 1, backgroundColor: '#fff' }]}>
              <Text style={[styles.bigBtnText, { color: '#000', fontSize: 17 }]}>Salir</Text>
            </Pressable>
          </View>
        </FormScroll>
      </SafeAreaView>
    );
  }

  // El lector ocupa la pantalla entera: con el animal adelante no hay lugar para media pantalla
  // de cámara. Al confirmar entra por el mismo camino que teclear —`findByTag`— así que la manga
  // no aprende una segunda forma de encontrar un animal.
  if (escaneando) {
    return (
      <EscanerDeCaravana
        encabezado="Leer caravana"
        resolver={(codigo) => {
          const encontrado = sync.findByTag(codigo);
          if (!encontrado) {
            return { titulo: 'No hay ningún animal con esa caravana', detalle: 'Probá de nuevo o escribila a mano.', confirmable: false };
          }
          const lote = encontrado.lot_name ? ` · ${encontrado.lot_name}` : '';
          return {
            titulo: `${encontrado.tag ?? '—'}${encontrado.name ? ` · ${encontrado.name}` : ''}`,
            detalle: `${encontrado.category ?? 'Sin categoría'}${lote}`,
            confirmable: true,
          };
        }}
        onConfirmar={(codigo) => {
          const encontrado = sync.findByTag(codigo);
          setEscaneando(false);
          if (!encontrado) return;
          setError('');
          setAnimal(encontrado);
          setTag('');
          haptics.ok();
        }}
        onCerrar={() => {
          setEscaneando(false);
          focusTag();
        }}
      />
    );
  }

  // ── Captura ──
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={[styles.dot, { backgroundColor: sync.offlineSim ? RED : GREEN }]} />
          <Text style={styles.topLabel} numberOfLines={1}>{sessionName || 'MANGA'}</Text>
          <View style={styles.modeChip}>
            <Text style={styles.modeChipText}>{mode}</Text>
          </View>
        </View>
        <Text style={styles.counter}>
          <Text style={{ color: GREEN }}>{saved}</Text>
          <Text style={styles.counterUnit}> reg </Text>
          <Text style={{ color: errors ? RED : 'rgba(255,255,255,0.3)' }}>{errors}</Text>
          <Text style={styles.counterUnit}> err</Text>
        </Text>
        <Pressable accessibilityRole="button" onPress={() => { setEndedAt(Date.now()); setPhase('summary'); }} style={styles.exitBtn}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Salir</Text>
        </Pressable>
      </View>

      <FormScroll contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!animal ? (
          <>
            <Text style={styles.stepLabel}>CARAVANA</Text>
            <TextInput
              ref={tagRef}
              value={tag}
              onChangeText={setTag}
              onSubmitEditing={lookup}
              keyboardType="number-pad"
              autoFocus
              style={styles.tagInput}
              accessibilityLabel="Caravana del animal"
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                onPress={lookup}
                disabled={!tag.trim()}
                style={[styles.bigBtn, { backgroundColor: '#fff', flex: 1, width: 'auto' }, !tag.trim() && { opacity: 0.3 }]}
              >
                <Text style={[styles.bigBtnText, { color: '#000' }]}>BUSCAR</Text>
              </Pressable>
              {/* El teclado nunca desaparece: leer es un atajo, no un reemplazo. */}
              <Pressable
                onPress={() => setEscaneando(true)}
                style={[styles.bigBtn, styles.btnEscanear]}
                accessibilityRole="button"
                accessibilityLabel="Leer la caravana con la cámara"
              >
                <Text style={[styles.bigBtnText, { color: '#fff' }]}>CÁMARA</Text>
              </Pressable>
            </View>

            {/* Cambiar de modo entre animales */}
            <View style={styles.wrapRow}>
              {modosPermitidos.map((m) => {
                const on = mode === m;
                return (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={m} onPress={() => setMode(m)} style={[styles.pillSm, on && styles.pillOn]}>
                    <Text style={[styles.pillTextSm, on && styles.pillTextOn]}>{m}</Text>
                  </Pressable>
                );
              })}
            </View>

            {records.length > 0 && (
              <View style={{ width: '100%', gap: 6 }}>
                <Text style={styles.sectionLabel}>ÚLTIMOS REGISTROS</Text>
                {records.slice(0, 4).map((r) => (
                  <View key={r.key} style={styles.recRow}>
                    <Text style={styles.recTag}>{r.tag}</Text>
                    <Text style={styles.recDetail} numberOfLines={1}>{r.action} · {r.detail}</Text>
                    <Text style={styles.recTime}>{clock(r.at)}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.hint}>Búsqueda y guardado 100% local — funciona sin señal</Text>
          </>
        ) : (
          <>
            <AnimalCard animal={animal} sync={sync} onAlertPress={setMode} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <ModeCapture
              mode={mode}
              animal={animal}
              sync={sync}
              lots={lots}
              vaccines={vaccines}
              meds={meds}
              bulls={bulls}
              warn={warn}
              setWarn={setWarn}
              confirmMsg={confirmMsg}
              setConfirmMsg={setConfirmMsg}
              onSaved={pushRecord}
              onFail={fail}
            />
            <Pressable accessibilityRole="button" onPress={() => { setAnimal(null); setError(''); setWarn(null); setConfirmMsg(null); focusTag(); }}>
              <Text style={styles.link}>Cambiar animal</Text>
            </Pressable>
          </>
        )}
      </FormScroll>
    </SafeAreaView>
  );
}

/**
 * Tarjeta del animal escaneado — datos LOCALES (offline).
 *
 * Las alertas salen de `mangaCardAlerts`, la MISMA regla que usa la manga de la web: antes cada
 * canal decidía por su cuenta y el móvil no mostraba retiro activo ni caso clínico abierto, que son
 * justo las dos que impiden mandar el animal a faena o pasarlo de largo estando enfermo.
 *
 * Y son accionables: tocar una salta al modo que la resuelve. Un aviso que obliga a recordar y
 * navegar —con guantes, en la manga— es un aviso que se ignora.
 */
function AnimalCard({
  animal,
  sync,
  onAlertPress,
}: {
  animal: AnimalRow;
  sync: ReturnType<typeof useSync>;
  onAlertPress: (mode: Mode) => void;
}) {
  const ahora = useAhora();
  const days = diasDesde(animal.last_weighed_at, ahora);
  const facts: [string, string][] = [];
  if (animal.last_weight_kg != null) facts.push(['ÚLTIMO PESO', `${Math.round(animal.last_weight_kg)} kg${days != null ? ` · hace ${days} d` : ''}`]);
  facts.push(['LOTE', animal.lot_name ?? 'sin lote']);
  if (animal.sex) facts.push(['SEXO', animal.sex === 'F' ? 'Hembra' : 'Macho']);

  // El retiro combina lo del servidor con lo que este dispositivo capturó sin señal; la preñez
  // abierta ya viaja en el bootstrap.
  const retiro = sync.withdrawalOf(animal.id);
  const prenez = sync.openPregnancy(animal.id);
  const alerts: MangaAlert[] = mangaCardAlerts({
    meatWithdrawalUntil: retiro.meat,
    milkWithdrawalUntil: retiro.milk,
    openCases: animal.open_cases,
    caseSeverity: animal.case_severity,
    sex: animal.sex,
    expectedDueDate: prenez?.expected_due_date ?? null,
    lotId: animal.current_lot_id,
    daysSinceWeighing: days,
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTag}>{animal.tag ?? '—'}</Text>
      <Text style={styles.cardSub}>
        {animal.name ? `${animal.name} · ` : ''}{animal.category ?? 'sin categoría'}
      </Text>
      <View style={styles.cardFacts}>
        {facts.map(([k, v]) => (
          <View key={k} style={{ minWidth: '45%' }}>
            <Text style={styles.factLabel}>{k}</Text>
            <Text style={styles.factValue}>{v}</Text>
          </View>
        ))}
      </View>
      {alerts.length > 0 && (
        <View style={styles.alertRow}>
          {alerts.map((al) => {
            const chip = [styles.alertChip, al.tone === 'danger' ? styles.alertChipDanger : null];
            // Sin modo (el retiro) no es tocable: no hay nada que capturar, hay que esperar.
            return al.mode ? (
              <Pressable
                key={al.code}
                onPress={() => onAlertPress(al.mode as Mode)}
                accessibilityRole="button"
                accessibilityLabel={al.text}
                hitSlop={8}
              >
                <Text style={chip}>{al.text}</Text>
              </Pressable>
            ) : (
              <Text key={al.code} style={chip}>
                {al.text}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

