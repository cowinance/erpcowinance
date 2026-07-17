import { describe, expect, it } from 'vitest';
import { computeReproStatus, DEFAULT_REPRO_CONFIG, ReproFacts } from './repro-status';

const cfg = DEFAULT_REPRO_CONFIG;
const TODAY = '2026-07-17';
const base: ReproFacts = {
  isHeifer: false, culledReproductively: false, expectedDueDate: null, lastCalvingDate: null,
  lastServiceDate: null, lastPositiveDiagnosisDate: null, lastNegativeDiagnosisDate: null,
  lastAbortionDate: null, servicesSinceCalving: 0, inActiveProtocol: false,
};
const f = (o: Partial<ReproFacts>): ReproFacts => ({ ...base, ...o });

describe('computeReproStatus — máquina de estados reproductiva (regla pura)', () => {
  it('preñada / próxima a parir según la fecha de parto', () => {
    expect(computeReproStatus(f({ expectedDueDate: '2026-10-01' }), cfg, TODAY).status).toBe('pregnant');
    expect(computeReproStatus(f({ expectedDueDate: '2026-07-25' }), cfg, TODAY).status).toBe('due_soon'); // dentro de 21 d
  });

  it('servida vs diagnóstico pendiente según ventana de diagnóstico', () => {
    expect(computeReproStatus(f({ lastServiceDate: '2026-07-01' }), cfg, TODAY).status).toBe('served'); // 16 d < 45
    expect(computeReproStatus(f({ lastServiceDate: '2026-05-01' }), cfg, TODAY).status).toBe('diagnosis_pending'); // 77 d ≥ 45
  });

  it('postparto: descanso → lista para revisión → lista para servicio', () => {
    expect(computeReproStatus(f({ lastCalvingDate: '2026-07-01' }), cfg, TODAY).status).toBe('postpartum_rest'); // 16 d
    expect(computeReproStatus(f({ lastCalvingDate: '2026-05-25' }), cfg, TODAY).status).toBe('ready_for_review'); // 53 d ∈ [45,60)
    const ready = computeReproStatus(f({ lastCalvingDate: '2026-05-01' }), cfg, TODAY); // 77 d ≥ 60
    expect(ready.status).toBe('ready_for_service');
    expect(ready.eligibleForService).toBe(true);
    expect(ready.daysPostpartum).toBe(77);
  });

  it('repetidora: varios servicios sin preñez tras el VWP', () => {
    const r = computeReproStatus(f({ lastCalvingDate: '2026-01-01', lastNegativeDiagnosisDate: '2026-07-05', servicesSinceCalving: 3 }), cfg, TODAY);
    expect(r.status).toBe('repeat_breeder');
  });

  it('abierta demasiado tiempo cuando superó el umbral', () => {
    const r = computeReproStatus(f({ lastCalvingDate: '2026-03-01', lastNegativeDiagnosisDate: '2026-07-01', servicesSinceCalving: 1 }), cfg, TODAY);
    expect(r.status).toBe('open'); // 138 días postparto ≥ 90, servicios < 3
    expect(r.daysOpen).toBe(138);
  });

  it('aborto reciente y descarte reproductivo', () => {
    expect(computeReproStatus(f({ lastAbortionDate: '2026-07-10' }), cfg, TODAY).status).toBe('aborted');
    expect(computeReproStatus(f({ culledReproductively: true, expectedDueDate: '2026-10-01' }), cfg, TODAY).status).toBe('culled');
  });

  it('vaquillona sin actividad → lista para servicio', () => {
    expect(computeReproStatus(f({ isHeifer: true }), cfg, TODAY).status).toBe('ready_for_service');
  });

  it('en protocolo cuando está abierta y en un protocolo activo', () => {
    expect(computeReproStatus(f({ inActiveProtocol: true, lastCalvingDate: '2026-01-01' }), cfg, TODAY).status).toBe('in_protocol');
  });
});
