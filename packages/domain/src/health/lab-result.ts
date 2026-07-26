import type { ClinicalCaseSeverity } from './clinical-case';

/**
 * Del resultado de laboratorio al caso clínico (Fase 3.1).
 *
 * Hoy el lazo lo cierra una persona: el laboratorio informa, el motor de alertas avisa, y alguien
 * tiene que acordarse de entrar a Sanidad, buscar el animal y abrir el caso retipeando el
 * diagnóstico. Es salud animal dependiendo de la memoria de alguien un día ocupado.
 *
 * La tentación es abrir un caso con CADA resultado fuera de rango. Sería peor: un mineral apenas
 * corrido de la referencia llenaría Sanidad de casos que nadie cierra, y una pila de casos abiertos
 * que nadie mira es menos útil que ninguno — enseña a ignorar la pantalla.
 *
 * El corte que sí sostiene la distinción es si el laboratorio dijo **QUÉ ES** o solo **que está
 * raro**:
 *
 *   - Resultado con DIAGNÓSTICO → es un hallazgo, no una señal. Abre el caso solo.
 *   - Resultado solo fuera de rango → hace falta criterio veterinario. Lo cubre la alerta
 *     `lab_result_abnormal`, que ahora ofrece abrir el caso en un clic.
 *
 * Puro, sin IO.
 */

export type LabAssessmentReason =
  /** `is_abnormal` no es `true`. NULL es «no se sabe», que no es lo mismo que negativo. */
  | 'not_abnormal'
  /** Muestra de suelo, agua o pastura: importa, pero no es un caso clínico de nadie. */
  | 'no_animal'
  /** Fuera de rango sin diagnóstico: necesita criterio veterinario, no automatismo. */
  | 'needs_judgement'
  /** Enfermedad de denuncia obligatoria. */
  | 'notifiable'
  /** Diagnóstico confirmado por el laboratorio. */
  | 'diagnosed';

export interface LabResultAssessment {
  /** Si corresponde abrir (o retomar) un caso clínico sin intervención humana. */
  opensCase: boolean;
  /** Severidad con la que nace el caso. `null` cuando no se abre. */
  severity: ClinicalCaseSeverity | null;
  reason: LabAssessmentReason;
  /** Explicación en el idioma del producto: la lee un veterinario, no un sistema. */
  explanation: string;
}

export interface LabResultInput {
  /** `lab_results.is_abnormal`. Tri-estado a propósito: NULL es «sin evaluar». */
  isAbnormal: boolean | null | undefined;
  /** La muestra salió de un animal concreto. */
  hasAnimal: boolean;
  /** Diagnóstico que el laboratorio informó, si lo informó. */
  diagnosisId: string | null | undefined;
  /** `diagnoses.is_notifiable`: enfermedad de denuncia obligatoria ante la autoridad sanitaria. */
  isNotifiable?: boolean | null;
}

/**
 * Decide si un resultado de laboratorio abre un caso clínico, y con qué severidad.
 *
 * Devuelve SIEMPRE el motivo, también cuando la respuesta es que no. Un «no se abrió» sin
 * explicación se lee como una falla del sistema y termina en alguien abriendo el caso a mano por
 * las dudas, que es justo lo que este lazo viene a evitar.
 */
export function assessLabResult(input: LabResultInput): LabResultAssessment {
  if (input.isAbnormal !== true) {
    return {
      opensCase: false,
      severity: null,
      reason: 'not_abnormal',
      explanation: 'El resultado no está marcado como fuera de rango.',
    };
  }

  if (!input.hasAnimal) {
    return {
      opensCase: false,
      severity: null,
      reason: 'no_animal',
      explanation: 'La muestra no es de un animal (suelo, agua o pastura): no corresponde un caso clínico.',
    };
  }

  if (!input.diagnosisId) {
    return {
      opensCase: false,
      severity: null,
      reason: 'needs_judgement',
      explanation: 'Fuera de rango, pero sin diagnóstico del laboratorio. Requiere criterio veterinario para abrir el caso.',
    };
  }

  // La denuncia obligatoria no es una gradación clínica sino una obligación legal, y por eso pesa
  // más que la gravedad del cuadro: un caso severo se mira hoy, uno moderado puede esperar al
  // recorrido de mañana. Con brucelosis o tuberculosis, esperar tiene consecuencias que exceden al
  // animal.
  if (input.isNotifiable === true) {
    return {
      opensCase: true,
      severity: 'severe',
      reason: 'notifiable',
      explanation: 'Diagnóstico de denuncia obligatoria confirmado por el laboratorio.',
    };
  }

  // Moderado y no leve: el laboratorio confirmó un diagnóstico, no es un hallazgo al pasar. Que lo
  // baje el veterinario si al ver al animal corresponde; el sistema no minimiza por su cuenta.
  return {
    opensCase: true,
    severity: 'moderate',
    reason: 'diagnosed',
    explanation: 'Diagnóstico confirmado por el laboratorio.',
  };
}
