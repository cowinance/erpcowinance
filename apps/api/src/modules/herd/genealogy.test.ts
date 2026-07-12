import { describe, it, expect } from 'vitest';
import { AnimalWriteService } from './animal-write.service';

/**
 * Unit PURO de `evaluateLink` (P2 P-d.1) — validación de vínculos genealógicos con
 * el contexto y los resultados de ciclos ya resueltos en lote (sin DB).
 */
const svc = new AnimalWriteService(undefined as any, undefined as any, undefined as any);

const CHILD = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DAM = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SIRE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const genCtx = new Map([
  ['MADRE1', { animalId: DAM, sex: 'F' }],
  ['PADRE1', { animalId: SIRE, sex: 'M' }],
  ['MACHO', { animalId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sex: 'M' }],
  ['SELF', { animalId: CHILD, sex: 'F' }],
]);
const noCycles = new Map<string, 'cycle' | 'cycle_check_limit' | 'ok'>();

describe('evaluateLink', () => {
  it('dam (F) y sire (M) válidos → damId/sireId y outcomes linked', () => {
    const r = svc.evaluateLink(CHILD, { damTag: 'MADRE1', sireTag: 'PADRE1' }, genCtx, noCycles);
    expect(r.damId).toBe(DAM);
    expect(r.sireId).toBe(SIRE);
    expect(r.outcomes).toEqual([
      { field: 'dam', outcome: 'linked' },
      { field: 'sire', outcome: 'linked' },
    ]);
  });

  it('referencia inexistente → not_found, sin vínculo', () => {
    const r = svc.evaluateLink(CHILD, { damTag: 'NOEXISTE' }, genCtx, noCycles);
    expect(r.damId).toBeUndefined();
    expect(r.outcomes).toEqual([{ field: 'dam', outcome: 'not_found' }]);
  });

  it('sexo parental incompatible (madre no es F) → sex_incompatible', () => {
    const r = svc.evaluateLink(CHILD, { damTag: 'MACHO' }, genCtx, noCycles);
    expect(r.damId).toBeUndefined();
    expect(r.outcomes).toEqual([{ field: 'dam', outcome: 'sex_incompatible' }]);
  });

  it('autorreferencia (padre = hijo) → self_ref', () => {
    const r = svc.evaluateLink(CHILD, { damTag: 'SELF' }, genCtx, noCycles);
    expect(r.damId).toBeUndefined();
    expect(r.outcomes).toEqual([{ field: 'dam', outcome: 'self_ref' }]);
  });

  it('ciclo detectado en lote → cycle, sin vínculo', () => {
    const cycles = new Map([[`${CHILD}|${DAM}`, 'cycle' as const]]);
    const r = svc.evaluateLink(CHILD, { damTag: 'MADRE1' }, genCtx, cycles);
    expect(r.damId).toBeUndefined();
    expect(r.outcomes).toEqual([{ field: 'dam', outcome: 'cycle' }]);
  });

  it('límite de chequeo de ciclo → cycle_check_limit (rechazo conservador)', () => {
    const cycles = new Map([[`${CHILD}|${DAM}`, 'cycle_check_limit' as const]]);
    const r = svc.evaluateLink(CHILD, { damTag: 'MADRE1' }, genCtx, cycles);
    expect(r.damId).toBeUndefined();
    expect(r.outcomes).toEqual([{ field: 'dam', outcome: 'cycle_check_limit' }]);
  });

  it('sin referencias → sin outcomes ni ids', () => {
    const r = svc.evaluateLink(CHILD, {}, genCtx, noCycles);
    expect(r.outcomes).toEqual([]);
    expect(r.damId).toBeUndefined();
    expect(r.sireId).toBeUndefined();
  });
});
