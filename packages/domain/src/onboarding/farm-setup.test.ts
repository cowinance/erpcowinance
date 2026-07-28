import { describe, expect, it } from 'vitest';
import { FARM_SETUP_STEPS, farmSetupProgress, type FarmSetupFacts } from './farm-setup';

const nada: FarmSetupFacts = { hasAnimals: false, hasLots: false, hasWeighings: false, hasHealthRecords: false };
const todo: FarmSetupFacts = { hasAnimals: true, hasLots: true, hasWeighings: true, hasHealthRecords: true };

describe('qué le falta a la finca para estar en marcha', () => {
  it('una finca recién creada tiene los cuatro pasos pendientes', () => {
    const p = farmSetupProgress(nada);
    expect(p.done).toBe(0);
    expect(p.total).toBe(4);
    expect(p.complete).toBe(false);
    expect(p.steps.every((s) => !s.done)).toBe(true);
  });

  it('SE APAGA SOLO Y NO VUELVE', () => {
    // La condición de terminado es el estado real, no un flag que alguien marca: el panel deja de
    // aparecer porque la finca está armada, no porque se lo escondió.
    const p = farmSetupProgress(todo);
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
    expect(p.done).toBe(p.total);
  });

  it('EL PASO SE TILDA CUANDO EL DATO EXISTE — Y SE DESTILDA SI DEJA DE EXISTIR', () => {
    // Es lo que gana derivarlo: no hay tabla de progreso que se desincronice el día que un dato se
    // borra. Si el productor elimina su único animal, vuelve a faltarle cargar el hato.
    const conAnimales = farmSetupProgress({ ...nada, hasAnimals: true });
    expect(conAnimales.steps.find((s) => s.code === 'herd')!.done).toBe(true);
    expect(farmSetupProgress(nada).steps.find((s) => s.code === 'herd')!.done).toBe(false);
  });

  it('`next` es el PRIMER pendiente, no cualquiera', () => {
    // Es el que se señala en la pantalla; si señalara uno del medio, mandaría al productor a hacer
    // algo que todavía no puede (un pesaje sin animales).
    expect(farmSetupProgress(nada).next).toBe('herd');
    expect(farmSetupProgress({ ...nada, hasAnimals: true }).next).toBe('lots');
    expect(farmSetupProgress({ ...todo, hasHealthRecords: false }).next).toBe('health');
  });

  it('cuenta bien con pasos salteados', () => {
    // El productor no sigue el orden: puede cargar animales y anotar una sanidad sin hacer lotes.
    const p = farmSetupProgress({ hasAnimals: true, hasLots: false, hasWeighings: false, hasHealthRecords: true });
    expect(p.done).toBe(2);
    expect(p.complete).toBe(false);
    expect(p.next).toBe('lots');
  });

  it('el orden es estable y son los cuatro declarados', () => {
    // La pantalla los numera: si el orden cambiara entre llamadas, el «paso 2» sería otro cada vez.
    expect(farmSetupProgress(nada).steps.map((s) => s.code)).toEqual([...FARM_SETUP_STEPS]);
    expect(farmSetupProgress(todo).steps.map((s) => s.code)).toEqual([...FARM_SETUP_STEPS]);
  });

  it('NINGÚN PASO ES OPCIONAL POR NATURALEZA', () => {
    // El invariante que evita el ruido permanente: los cuatro los hace cualquier explotación
    // ganadera. Potreros, equipo o genética son reales pero no universales — pedirlos dejaría el
    // panel encendido para siempre en una finca que legítimamente no los usa.
    expect([...FARM_SETUP_STEPS]).toEqual(['herd', 'lots', 'weighing', 'health']);
  });
});
