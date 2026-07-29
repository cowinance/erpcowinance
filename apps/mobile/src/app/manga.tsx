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
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { mangaCardAlerts, validateWeighing, type MangaAlert } from '@cowinance/domain';
import { useSync, AnimalRow } from '@/sync/SyncContext';
import { FormScroll } from '@/components/ui';
import * as haptics from '@/lib/haptics';

const GREEN = '#4ADE80';
const RED = '#F87171';
const AMBER = '#FACC15';
const CC_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5];
const SCAN_DEBOUNCE_MS = 1500;

type Mode = 'Pesaje' | 'Revisión' | 'Nota' | 'Tratamiento' | 'Vacunación' | 'Movimiento' | 'Reproducción';
const MODES: Mode[] = ['Pesaje', 'Revisión', 'Nota', 'Tratamiento', 'Vacunación', 'Movimiento', 'Reproducción'];
const NOTE_TEMPLATES = ['cojea', 'flaco', 'revisar ojo', 'revisar ubre', 'agresivo', 'sin novedad'];

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
  const [phase, setPhase] = useState<'setup' | 'capture' | 'summary'>('setup');
  const [mode, setMode] = useState<Mode>('Pesaje');
  const [sessionName, setSessionName] = useState('');
  const [targetLot, setTargetLot] = useState<{ id: string; name: string } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [errors, setErrors] = useState(0);

  const [animal, setAnimal] = useState<AnimalRow | null>(null);
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const tagRef = useRef<TextInput>(null);
  const lastScan = useRef<{ v: string; at: number }>({ v: '', at: 0 });

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
  const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));

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
            <Pressable onPress={() => setTargetLot(null)} style={[styles.pill, !targetLot && styles.pillOn]}>
              <Text style={[styles.pillText, !targetLot && styles.pillTextOn]}>Todos</Text>
            </Pressable>
            {lots.slice(0, 8).map((l) => {
              const on = targetLot?.id === l.id;
              return (
                <Pressable key={l.id} onPress={() => setTargetLot({ id: l.id, name: l.name })} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{l.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>MODO</Text>
          <View style={styles.wrapRow}>
            {MODES.map((m) => {
              const on = mode === m;
              return (
                <Pressable key={m} onPress={() => setMode(m)} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{m}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              setStartedAt(Date.now());
              setRecords([]);
              setErrors(0);
              setPhase('capture');
              focusTag();
            }}
            style={[styles.bigBtn, { backgroundColor: '#fff' }]}
          >
            <Text style={[styles.bigBtnText, { color: '#000' }]}>EMPEZAR</Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
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
            <Pressable onPress={() => setPhase('setup')} style={[styles.bigBtn, { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <Text style={[styles.bigBtnText, { color: '#fff', fontSize: 17 }]}>Nueva sesión</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={[styles.bigBtn, { flex: 1, backgroundColor: '#fff' }]}>
              <Text style={[styles.bigBtnText, { color: '#000', fontSize: 17 }]}>Salir</Text>
            </Pressable>
          </View>
        </FormScroll>
      </SafeAreaView>
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
        <Pressable onPress={() => setPhase('summary')} style={styles.exitBtn}>
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
            <Pressable onPress={lookup} disabled={!tag.trim()} style={[styles.bigBtn, { backgroundColor: '#fff' }, !tag.trim() && { opacity: 0.3 }]}>
              <Text style={[styles.bigBtnText, { color: '#000' }]}>BUSCAR</Text>
            </Pressable>

            {/* Cambiar de modo entre animales */}
            <View style={styles.wrapRow}>
              {MODES.map((m) => {
                const on = mode === m;
                return (
                  <Pressable key={m} onPress={() => setMode(m)} style={[styles.pillSm, on && styles.pillOn]}>
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
            <Pressable onPress={() => { setAnimal(null); setError(''); setWarn(null); setConfirmMsg(null); focusTag(); }}>
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
  const days = animal.last_weighed_at
    ? Math.floor((Date.now() - new Date(animal.last_weighed_at).getTime()) / 86400000)
    : null;
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

/** Captura por modo — cada una delega en la captura offline existente. */
function ModeCapture({ mode, animal, sync, lots, vaccines, meds, bulls, warn, setWarn, confirmMsg, setConfirmMsg, onSaved, onFail }: any) {
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [productId, setProductId] = useState('');
  const [dest, setDest] = useState('');
  const [reproAction, setReproAction] = useState<'celo' | 'servicio' | 'diagnostico' | null>(null);
  const [method, setMethod] = useState<'ai' | 'natural'>('ai');
  const [sireId, setSireId] = useState('');
  const [result, setResult] = useState<'pregnant' | 'empty'>('pregnant');

  // ── Pesaje: MISMA regla de dominio que la web (validateWeighing) ──
  if (mode === 'Pesaje') {
    const days = animal.last_weighed_at ? Math.floor((Date.now() - new Date(animal.last_weighed_at).getTime()) / 86400000) : null;
    const save = () => {
      const v = validateWeighing({ weightKg: Number(kg), lastWeightKg: animal.last_weight_kg ?? null, daysSinceLast: days });
      if (!v.ok) return onFail(v.error!.message.toUpperCase());
      if (v.requiresConfirm && !confirmMsg) {
        setConfirmMsg(v.confirm!.message);
        setWarn(null);
        haptics.warn();
        return;
      }
      setWarn(v.warnings.length ? v.warnings[0].message : null);
      sync.captureWeighing(animal.id, Number(kg), cc ?? undefined);
      onSaved('Pesaje', `${kg} kg${cc ? ` · CC ${cc}` : ''}`);
      setKg('');
      setCc(null);
    };
    return (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput
            value={kg}
            onChangeText={(t) => { setKg(t); setConfirmMsg(null); setWarn(null); }}
            onSubmitEditing={save}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.2)"
            style={styles.kgInput}
            accessibilityLabel="Peso en kilogramos"
            autoFocus
          />
          <Text style={styles.kgUnit}>kg</Text>
        </View>
        <Text style={styles.stepLabel}>CONDICIÓN CORPORAL</Text>
        <View style={styles.wrapRow}>
          {CC_OPTIONS.map((v) => (
            <Pressable key={v} onPress={() => setCc(cc === v ? null : v)} style={[styles.ccBtn, cc === v && { backgroundColor: GREEN }]}>
              <Text style={[styles.ccText, cc === v && { color: '#000' }]}>{v}</Text>
            </Pressable>
          ))}
        </View>
        {!!warn && <Text style={styles.warn}>⚠ {warn}</Text>}
        {!!confirmMsg && <Text style={styles.confirm}>⚠ {confirmMsg}</Text>}
        <Pressable onPress={save} disabled={!kg} style={[styles.bigBtn, { backgroundColor: confirmMsg ? AMBER : GREEN }, !kg && { opacity: 0.3 }]}>
          <Text style={[styles.bigBtnText, { color: '#000' }]}>{confirmMsg ? 'CONFIRMAR Y GUARDAR' : 'GUARDAR Y SIGUIENTE'}</Text>
        </Pressable>
      </>
    );
  }

  if (mode === 'Revisión' || mode === 'Nota') {
    const isReview = mode === 'Revisión';
    const save = () => {
      const text = isReview ? `Revisado${note.trim() ? ` · ${note.trim()}` : ''}` : note.trim();
      if (!text) return;
      sync.captureNote(animal.id, text);
      onSaved(isReview ? 'Revisión' : 'Nota', isReview ? 'revisado' : text.slice(0, 30));
      setNote('');
    };
    return (
      <>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={isReview ? 'Nota corta (opcional)' : 'Escribí una nota…'}
          placeholderTextColor="rgba(255,255,255,0.25)"
          style={styles.textInput}
          multiline={!isReview}
        />
        {!isReview && (
          <View style={styles.wrapRow}>
            {NOTE_TEMPLATES.map((t) => (
              <Pressable key={t} onPress={() => setNote((n) => (n.trim() ? `${n.trim()} · ${t}` : t))} style={styles.pillSm}>
                <Text style={styles.pillTextSm}>{t}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable onPress={save} disabled={!isReview && !note.trim()} style={[styles.bigBtn, { backgroundColor: GREEN }, !isReview && !note.trim() && { opacity: 0.3 }]}>
          <Text style={[styles.bigBtnText, { color: '#000' }]}>{isReview ? 'REVISADO ✓ Y SIGUIENTE' : 'GUARDAR NOTA'}</Text>
        </Pressable>
      </>
    );
  }

  if (mode === 'Tratamiento' || mode === 'Vacunación') {
    const list = mode === 'Vacunación' ? vaccines : meds;
    const save = () => {
      if (!productId) return;
      const p = list.find((x: any) => x.id === productId);
      if (mode === 'Vacunación') {
        sync.captureVaccination(animal.id, productId);
        onSaved('Vacunación', p?.name ?? 'vacuna');
      } else {
        const r = sync.captureTreatment(animal.id, productId);
        onSaved('Tratamiento', `${p?.name ?? 'tratamiento'}${r?.meatUntil ? ` · retiro ${r.meatUntil.slice(5)}` : ''}`);
      }
      setProductId('');
    };
    return (
      <>
        {animal.status && animal.status !== 'active' && <Text style={styles.warn}>⚠ Animal no activo</Text>}
        <Text style={styles.stepLabel}>{mode === 'Vacunación' ? 'VACUNA' : 'PRODUCTO'}</Text>
        {list.length === 0 ? (
          <Text style={styles.hint}>Sin productos en la base local. Sincronizá para traer el vademécum.</Text>
        ) : (
          <View style={styles.wrapRow}>
            {list.slice(0, 10).map((p: any) => {
              const on = productId === p.id;
              return (
                <Pressable key={p.id} onPress={() => setProductId(p.id)} style={[styles.pillSm, on && styles.pillOn]}>
                  <Text style={[styles.pillTextSm, on && styles.pillTextOn]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Pressable onPress={save} disabled={!productId} style={[styles.bigBtn, { backgroundColor: GREEN }, !productId && { opacity: 0.3 }]}>
          <Text style={[styles.bigBtnText, { color: '#000' }]}>{mode === 'Vacunación' ? 'GUARDAR VACUNA' : 'GUARDAR TRATAMIENTO'}</Text>
        </Pressable>
      </>
    );
  }

  if (mode === 'Movimiento') {
    const save = () => {
      if (!dest) return;
      const lot = lots.find((l: any) => l.id === dest);
      sync.captureMovement(animal.id, dest === 'clear' ? null : dest);
      onSaved('Movimiento', `→ ${dest === 'clear' ? 'sin lote' : lot?.name ?? 'lote'}`);
      setDest('');
    };
    return (
      <>
        <Text style={styles.hint}>Actual: {animal.lot_name ?? 'sin lote'}</Text>
        <Text style={styles.stepLabel}>LOTE DESTINO</Text>
        <View style={styles.wrapRow}>
          {lots.filter((l: any) => l.id !== animal.current_lot_id).slice(0, 10).map((l: any) => {
            const on = dest === l.id;
            return (
              <Pressable key={l.id} onPress={() => setDest(l.id)} style={[styles.pillSm, on && styles.pillOn]}>
                <Text style={[styles.pillTextSm, on && styles.pillTextOn]}>{l.name}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setDest('clear')} style={[styles.pillSm, dest === 'clear' && styles.pillOn]}>
            <Text style={[styles.pillTextSm, dest === 'clear' && styles.pillTextOn]}>Sacar del lote</Text>
          </Pressable>
        </View>
        <Pressable onPress={save} disabled={!dest} style={[styles.bigBtn, { backgroundColor: GREEN }, !dest && { opacity: 0.3 }]}>
          <Text style={[styles.bigBtnText, { color: '#000' }]}>MOVER Y SIGUIENTE</Text>
        </Pressable>
      </>
    );
  }

  // Reproducción
  if (animal.sex !== 'F') {
    return <Text style={styles.hint}>Este animal es macho. Registrá el servicio desde la hembra eligiéndolo como toro.</Text>;
  }
  const runRepro = () => {
    if (reproAction === 'celo') {
      sync.captureHeat(animal.id);
      onSaved('Celo', 'registrado');
    } else if (reproAction === 'servicio') {
      sync.captureService(animal.id, method, sireId || undefined);
      onSaved('Servicio', method === 'ai' ? 'IA' : 'monta');
    } else if (reproAction === 'diagnostico') {
      const r = sync.captureDiagnosis(animal.id, result);
      onSaved('Diagnóstico', result === 'pregnant' ? `preñada${r?.expectedDue ? ` · parto ${r.expectedDue.slice(5)}` : ''}` : 'vacía');
    }
    setReproAction(null);
  };
  return (
    <>
      <View style={styles.wrapRow}>
        {(['celo', 'servicio', 'diagnostico'] as const).map((a) => {
          const on = reproAction === a;
          return (
            <Pressable key={a} onPress={() => setReproAction(a)} style={[styles.pill, on && styles.pillOn]}>
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{a === 'diagnostico' ? 'Diagnóstico' : a === 'celo' ? 'Celo' : 'Servicio'}</Text>
            </Pressable>
          );
        })}
      </View>
      {reproAction === 'servicio' && (
        <View style={{ width: '100%', gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['ai', 'natural'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMethod(m)} style={[styles.pill, { flex: 1 }, method === m && styles.pillOn]}>
                <Text style={[styles.pillText, method === m && styles.pillTextOn]}>{m === 'ai' ? 'IA' : 'Monta'}</Text>
              </Pressable>
            ))}
          </View>
          {method === 'natural' && bulls.length > 0 && (
            <View style={styles.wrapRow}>
              {bulls.slice(0, 8).map((b: AnimalRow) => (
                <Pressable key={b.id} onPress={() => setSireId(b.id)} style={[styles.pillSm, sireId === b.id && styles.pillOn]}>
                  <Text style={[styles.pillTextSm, sireId === b.id && styles.pillTextOn]}>{b.tag ?? b.id.slice(0, 6)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
      {reproAction === 'diagnostico' && (
        <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
          {(['pregnant', 'empty'] as const).map((r) => (
            <Pressable key={r} onPress={() => setResult(r)} style={[styles.pill, { flex: 1 }, result === r && styles.pillOn]}>
              <Text style={[styles.pillText, result === r && styles.pillTextOn]}>{r === 'pregnant' ? 'Preñada' : 'Vacía'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable onPress={runRepro} disabled={!reproAction} style={[styles.bigBtn, { backgroundColor: GREEN }, !reproAction && { opacity: 0.3 }]}>
        <Text style={[styles.bigBtnText, { color: '#000' }]}>{reproAction ? 'GUARDAR Y SIGUIENTE' : 'ELEGÍ UNA ACCIÓN'}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  setupBody: { padding: 24, gap: 14, alignItems: 'center', paddingBottom: 48 },
  kicker: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700', letterSpacing: 3 },
  setupTitle: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  fieldLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', letterSpacing: 2, alignSelf: 'flex-start', marginTop: 6 },
  setupInput: {
    width: '100%', height: 52, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 12,
    paddingHorizontal: 14, color: '#fff', fontSize: 18, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  textInput: {
    width: '100%', minHeight: 52, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 18, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', justifyContent: 'center' },
  pill: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  pillSm: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  pillOn: { backgroundColor: GREEN, borderColor: GREEN },
  pillText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '700' },
  pillTextSm: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  pillTextOn: { color: '#000' },
  bigBtn: { height: 68, width: '100%', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bigBtnText: { fontSize: 20, fontWeight: '800' },
  link: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecorationLine: 'underline', marginTop: 8 },
  topBar: {
    height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.2)', gap: 8,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  topLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  modeChip: { backgroundColor: 'rgba(74,222,128,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  modeChipText: { color: GREEN, fontSize: 12, fontWeight: '700' },
  counter: { fontSize: 17, fontWeight: '700', fontFamily: 'monospace' },
  counterUnit: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '400' },
  exitBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 20, paddingVertical: 24 },
  stepLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  sectionLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 2, textAlign: 'center' },
  tagInput: {
    width: 260, borderBottomWidth: 4, borderBottomColor: 'rgba(255,255,255,0.4)', color: '#fff',
    fontSize: 56, fontWeight: '700', fontFamily: 'monospace', textAlign: 'center', paddingVertical: 4,
  },
  kgInput: {
    width: 200, borderBottomWidth: 4, borderBottomColor: 'rgba(255,255,255,0.4)', color: '#fff',
    fontSize: 48, fontWeight: '700', fontFamily: 'monospace', textAlign: 'center', paddingVertical: 4,
  },
  kgUnit: { color: 'rgba(255,255,255,0.5)', fontSize: 22, fontWeight: '700', paddingBottom: 10 },
  ccBtn: { minWidth: 52, height: 52, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  ccText: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '700' },
  error: { color: RED, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  warn: { color: AMBER, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  confirm: { color: AMBER, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.35)', fontSize: 13, textAlign: 'center' },
  card: { width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 18, gap: 4 },
  cardTag: { color: GREEN, fontSize: 46, fontWeight: '800', fontFamily: 'monospace' },
  cardSub: { color: 'rgba(255,255,255,0.7)', fontSize: 16 },
  cardFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  factLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  factValue: { color: '#fff', fontSize: 17, fontFamily: 'monospace', marginTop: 2 },
  alertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  alertChip: { backgroundColor: AMBER, color: '#000', fontSize: 13, fontWeight: '800', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  // Rojo para lo que impide seguir (retiro, caso abierto); ámbar para lo que conviene resolver.
  alertChipDanger: { backgroundColor: RED, color: '#fff' },
  statRow: { flexDirection: 'row', gap: 10, width: '100%' },
  stat: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12 },
  statValue: { fontSize: 30, fontWeight: '800', fontFamily: 'monospace' },
  statLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, width: '100%' },
  recTag: { color: GREEN, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  recDetail: { color: 'rgba(255,255,255,0.6)', fontSize: 13, flex: 1 },
  recTime: { color: 'rgba(255,255,255,0.35)', fontSize: 12 },
});
