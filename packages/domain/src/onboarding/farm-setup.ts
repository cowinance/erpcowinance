/**
 * ¿Qué le falta a esta finca para estar en marcha?
 *
 * El Inicio ya mostraba una guía de tres pasos cuando el hato estaba vacío, pero era **una foto,
 * no un estado**: los pasos no se tildaban nunca y el panel entero desaparecía al cargar el primer
 * animal — justo cuando el productor todavía no tiene lotes, ni un pesaje, ni una sanidad, y la app
 * no puede decirle nada útil porque no hay de dónde. La guía se iba en el peor momento: cuando
 * empezaba a hacer falta.
 *
 * Acá se calcula qué pasos están dados, **derivándolo del estado real**: no hay una tabla de
 * «progreso de onboarding» que alguien tenga que acordarse de actualizar y que se desincronice el
 * día que un dato se borra. Si el productor carga un animal, el paso está dado; si borra todos, deja
 * de estarlo. La única fuente es la finca.
 *
 * **Por qué estos cuatro y no diez.** Un checklist que no se termina nunca es ruido —y ruido en la
 * primera pantalla, que es la que más se abre—. Estos cuatro son los que hace cualquier explotación
 * ganadera en sus primeras semanas, y cada uno DESBLOQUEA algo concreto que hoy está apagado: sin
 * animales no hay nada; sin lotes el trabajo no se puede organizar por grupo; sin un pesaje no hay
 * GDP ni curva; sin una sanidad no hay retiros ni alertas sanitarias. Cosas como potreros, equipo o
 * genética son reales pero NO universales: pedirlas dejaría el panel encendido para siempre en una
 * finca que legítimamente no las usa.
 *
 * Puro, sin IO: acá vive el orden y la condición de cada paso; los textos y los enlaces los pone
 * quien responde, como ya hace la atención prioritaria.
 */

/** Los pasos, en el orden en que tienen sentido: cada uno se apoya en el anterior. */
export const FARM_SETUP_STEPS = ['herd', 'lots', 'weighing', 'health'] as const;

export type FarmSetupStep = (typeof FARM_SETUP_STEPS)[number];

/** Lo único que hay que preguntarle a la base: si existe al menos uno de cada cosa. */
export interface FarmSetupFacts {
  readonly hasAnimals: boolean;
  readonly hasLots: boolean;
  readonly hasWeighings: boolean;
  readonly hasHealthRecords: boolean;
}

export interface FarmSetupProgress {
  readonly steps: readonly { readonly code: FarmSetupStep; readonly done: boolean }[];
  readonly done: number;
  readonly total: number;
  /** `true` cuando no queda nada por hacer: el panel se apaga solo y no vuelve. */
  readonly complete: boolean;
  /** El primer paso pendiente — el que conviene señalar. `null` si están todos. */
  readonly next: FarmSetupStep | null;
}

/** El estado de los pasos a partir de los hechos de la finca. */
export function farmSetupProgress(facts: FarmSetupFacts): FarmSetupProgress {
  const hecho: Record<FarmSetupStep, boolean> = {
    herd: facts.hasAnimals,
    lots: facts.hasLots,
    weighing: facts.hasWeighings,
    health: facts.hasHealthRecords,
  };
  const steps = FARM_SETUP_STEPS.map((code) => ({ code, done: hecho[code] }));
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done)?.code ?? null,
  };
}
