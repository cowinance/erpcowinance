import { describe, expect, it } from 'vitest';
import { assessLabResult } from './lab-result';

const positivo = { isAbnormal: true, hasAnimal: true, diagnosisId: 'd1', isNotifiable: false };

describe('del resultado de laboratorio al caso clínico', () => {
  it('un diagnóstico confirmado abre el caso sin que nadie se acuerde', () => {
    // Es la razón de ser del lazo: hoy depende de que alguien entre a Sanidad y lo cargue a mano.
    const r = assessLabResult(positivo);
    expect(r.opensCase).toBe(true);
    expect(r.severity).toBe('moderate');
  });

  it('la enfermedad de denuncia obligatoria nace SEVERA', () => {
    // No es una gradación clínica sino una obligación legal: esperar al recorrido de mañana tiene
    // consecuencias que exceden al animal.
    const r = assessLabResult({ ...positivo, isNotifiable: true });
    expect(r.severity).toBe('severe');
    expect(r.reason).toBe('notifiable');
  });

  it('FUERA DE RANGO SIN DIAGNÓSTICO NO ABRE CASO', () => {
    // La regla que evita que Sanidad se llene de casos que nadie cierra. Un mineral apenas corrido
    // de la referencia no es un episodio sanitario; lo cubre la alerta, con criterio humano.
    const r = assessLabResult({ ...positivo, diagnosisId: null });
    expect(r.opensCase).toBe(false);
    expect(r.reason).toBe('needs_judgement');
  });

  it('un resultado NO anormal no abre nada, aunque traiga diagnóstico', () => {
    // Un análisis de control que da negativo también nombra la enfermedad que se buscaba.
    const r = assessLabResult({ ...positivo, isAbnormal: false });
    expect(r.opensCase).toBe(false);
    expect(r.reason).toBe('not_abnormal');
  });

  it('«sin evaluar» (null) NO es positivo', () => {
    // Tratar el NULL como anormal abriría casos por resultados que nadie leyó todavía.
    for (const v of [null, undefined]) {
      const r = assessLabResult({ ...positivo, isAbnormal: v });
      expect(r.opensCase).toBe(false);
      expect(r.reason).toBe('not_abnormal');
    }
  });

  it('una muestra de suelo o agua no tiene caso clínico, y lo dice', () => {
    const r = assessLabResult({ ...positivo, hasAnimal: false });
    expect(r.opensCase).toBe(false);
    expect(r.reason).toBe('no_animal');
    expect(r.explanation).toMatch(/suelo/i);
  });

  it('SIEMPRE explica el motivo, también cuando la respuesta es que no', () => {
    // Un «no se abrió» mudo se lee como falla y termina en alguien abriendo el caso por las dudas.
    const casos = [
      positivo,
      { ...positivo, isAbnormal: false },
      { ...positivo, diagnosisId: null },
      { ...positivo, hasAnimal: false },
      { ...positivo, isNotifiable: true },
    ];
    for (const c of casos) expect(assessLabResult(c).explanation.length).toBeGreaterThan(10);
  });

  it('la severidad es null exactamente cuando no se abre el caso', () => {
    // Una severidad sin caso sería un número suelto que alguien terminaría mostrando.
    for (const c of [positivo, { ...positivo, isAbnormal: false }, { ...positivo, diagnosisId: null }, { ...positivo, isNotifiable: true }]) {
      const r = assessLabResult(c);
      expect(r.severity === null).toBe(!r.opensCase);
    }
  });
});
