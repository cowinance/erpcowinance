import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { validateWeighing } from '@cowinance/domain';
import * as haptics from '@/lib/haptics';
import type { AnimalRow } from '@/sync/SyncContext';
import { AMBER, CC_OPTIONS, GREEN, styles } from './estilos';

const NOTE_TEMPLATES = ['cojea', 'flaco', 'revisar ojo', 'revisar ubre', 'agresivo', 'sin novedad'];


/** Captura por modo — cada una delega en la captura offline existente. */
export function ModeCapture({ mode, animal, sync, lots, vaccines, meds, bulls, warn, setWarn, confirmMsg, setConfirmMsg, onSaved, onFail }: any) {
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
            <Pressable accessibilityRole="button" accessibilityState={{ selected: cc === v }} key={v} onPress={() => setCc(cc === v ? null : v)} style={[styles.ccBtn, cc === v && { backgroundColor: GREEN }]}>
              <Text style={[styles.ccText, cc === v && { color: '#000' }]}>{v}</Text>
            </Pressable>
          ))}
        </View>
        {!!warn && <Text style={styles.warn}>⚠ {warn}</Text>}
        {!!confirmMsg && <Text style={styles.confirm}>⚠ {confirmMsg}</Text>}
        <Pressable accessibilityRole="button" onPress={save} disabled={!kg} style={[styles.bigBtn, { backgroundColor: confirmMsg ? AMBER : GREEN }, !kg && { opacity: 0.3 }]}>
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
              <Pressable accessibilityRole="button" key={t} onPress={() => setNote((n) => (n.trim() ? `${n.trim()} · ${t}` : t))} style={styles.pillSm}>
                <Text style={styles.pillTextSm}>{t}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable accessibilityRole="button" onPress={save} disabled={!isReview && !note.trim()} style={[styles.bigBtn, { backgroundColor: GREEN }, !isReview && !note.trim() && { opacity: 0.3 }]}>
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
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={p.id} onPress={() => setProductId(p.id)} style={[styles.pillSm, on && styles.pillOn]}>
                  <Text style={[styles.pillTextSm, on && styles.pillTextOn]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Pressable accessibilityRole="button" onPress={save} disabled={!productId} style={[styles.bigBtn, { backgroundColor: GREEN }, !productId && { opacity: 0.3 }]}>
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
              <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} key={l.id} onPress={() => setDest(l.id)} style={[styles.pillSm, on && styles.pillOn]}>
                <Text style={[styles.pillTextSm, on && styles.pillTextOn]}>{l.name}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => setDest('clear')} style={[styles.pillSm, dest === 'clear' && styles.pillOn]}>
            <Text style={[styles.pillTextSm, dest === 'clear' && styles.pillTextOn]}>Sacar del lote</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" onPress={save} disabled={!dest} style={[styles.bigBtn, { backgroundColor: GREEN }, !dest && { opacity: 0.3 }]}>
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
            <Pressable accessibilityRole="button" key={a} onPress={() => setReproAction(a)} style={[styles.pill, on && styles.pillOn]}>
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{a === 'diagnostico' ? 'Diagnóstico' : a === 'celo' ? 'Celo' : 'Servicio'}</Text>
            </Pressable>
          );
        })}
      </View>
      {reproAction === 'servicio' && (
        <View style={{ width: '100%', gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['ai', 'natural'] as const).map((m) => (
              <Pressable accessibilityRole="button" key={m} onPress={() => setMethod(m)} style={[styles.pill, { flex: 1 }, method === m && styles.pillOn]}>
                <Text style={[styles.pillText, method === m && styles.pillTextOn]}>{m === 'ai' ? 'IA' : 'Monta'}</Text>
              </Pressable>
            ))}
          </View>
          {method === 'natural' && bulls.length > 0 && (
            <View style={styles.wrapRow}>
              {bulls.slice(0, 8).map((b: AnimalRow) => (
                <Pressable accessibilityRole="button" key={b.id} onPress={() => setSireId(b.id)} style={[styles.pillSm, sireId === b.id && styles.pillOn]}>
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
            <Pressable accessibilityRole="button" key={r} onPress={() => setResult(r)} style={[styles.pill, { flex: 1 }, result === r && styles.pillOn]}>
              <Text style={[styles.pillText, result === r && styles.pillTextOn]}>{r === 'pregnant' ? 'Preñada' : 'Vacía'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={runRepro} disabled={!reproAction} style={[styles.bigBtn, { backgroundColor: GREEN }, !reproAction && { opacity: 0.3 }]}>
        <Text style={[styles.bigBtnText, { color: '#000' }]}>{reproAction ? 'GUARDAR Y SIGUIENTE' : 'ELEGÍ UNA ACCIÓN'}</Text>
      </Pressable>
    </>
  );
}
