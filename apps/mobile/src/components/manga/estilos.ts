/**
 * Estilos y constantes de la manga, compartidos por el armazón (`app/manga.tsx`) y el formulario
 * de captura (`ModeCapture`). Viven acá desde que los dos dejaron de estar en el mismo archivo.
 *
 * Colores a mano y no del tema, a propósito: la manga es alto contraste sobre negro, pensada para
 * sol directo y guantes, y no sigue el modo claro/oscuro del sistema.
 */
import { StyleSheet } from 'react-native';

export const GREEN = '#4ADE80';
export const RED = '#F87171';
export const AMBER = '#FACC15';
export const CC_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5];

export type Mode = 'Pesaje' | 'Revisión' | 'Nota' | 'Tratamiento' | 'Vacunación' | 'Movimiento' | 'Reproducción';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  setupBody: { padding: 24, gap: 14, alignItems: 'center', paddingBottom: 48 },
  kicker: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700', letterSpacing: 3 },
  setupTitle: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  fieldLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', letterSpacing: 2, alignSelf: 'flex-start', marginTop: 6 },
  // `minHeight` como su vecino `textInput`, que ya lo tenía: son el mismo campo y estaban escritos
  // distinto. Con `height` el texto del sistema en grande desbordaba la caja.
  setupInput: {
    width: '100%', minHeight: 52, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 12,
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
  bigBtn: { minHeight: 68, paddingVertical: 12, width: '100%', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bigBtnText: { fontSize: 20, fontWeight: '800' },
  // `bigBtn` trae `width: '100%'`, que en una fila empujaría al otro botón fuera de la pantalla.
  btnEscanear: {
    width: 'auto',
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  link: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textDecorationLine: 'underline', marginTop: 8 },
  topBar: {
    minHeight: 56, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
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
  ccBtn: { minWidth: 52, minHeight: 52, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
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

