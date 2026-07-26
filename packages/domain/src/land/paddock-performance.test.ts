import { describe, expect, it } from 'vitest';
import { classifyWater, computePaddockPerformance, performanceConfidence } from './paddock-performance';

/** Un pastoreo cerrado y medido. */
const ventana = (grazingDays: number, gainKg: number | null, animalsMeasured: number) => ({ grazingDays, gainKg, animalsMeasured });

const base = { areaHa: 20, periodDays: 90, waterBalanceMm: 0, rainMm: 200 };

describe('rendimiento del potrero en kilos por hectárea', () => {
  it('reparte los kilos sobre la superficie y los días de ocupación', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, 1200, 40)] });
    expect(r.gainKg).toBe(1200);
    expect(r.gainKgPerHa).toBe(60); // 1200 / 20 ha
    expect(r.gainKgPerHaPerDay).toBe(2); // 60 / 30 días
  });

  it('acumula varios pastoreos del período', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(20, 800, 30), ventana(15, 400, 30)] });
    expect(r.grazingDays).toBe(35);
    expect(r.gainKg).toBe(1200);
  });

  it('UN PASTOREO SIN PESAJES NO ES UN PASTOREO CON GANANCIA CERO', () => {
    // Si contara como cero, un potrero por el que nadie pasó la balanza se hundiría en el ranking y
    // saldría de la rotación por no haber sido medido.
    const medido = computePaddockPerformance({ ...base, windows: [ventana(30, 1200, 40)] });
    const conUnoSinMedir = computePaddockPerformance({ ...base, windows: [ventana(30, 1200, 40), ventana(25, null, 0)] });
    expect(conUnoSinMedir.gainKgPerHaPerDay).toBe(medido.gainKgPerHaPerDay);
    // Pero los días de ocupación SÍ se cuentan: el potrero estuvo ocupado igual.
    expect(conUnoSinMedir.grazingDays).toBe(55);
  });

  it('sin ningún pesaje no inventa un rendimiento', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, null, 0)] });
    expect(r.gainKg).toBeNull();
    expect(r.gainKgPerHa).toBeNull();
    expect(r.confidence).toBe('sin_datos');
    expect(r.caveat).toMatch(/pesar a la entrada y a la salida/i);
  });

  it('sin superficie cargada no hay kilos por hectárea', () => {
    // El kg suelto no es comparable entre potreros: sin ha, el número engaña.
    const r = computePaddockPerformance({ ...base, areaHa: null, windows: [ventana(30, 1200, 40)] });
    expect(r.gainKg).toBe(1200);
    expect(r.gainKgPerHa).toBeNull();
  });

  it('un pastoreo abierto no aporta días ni ganancia', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, 900, 30), { grazingDays: null, gainKg: null, animalsMeasured: 0 }] });
    expect(r.grazingDays).toBe(30);
    expect(r.gainKg).toBe(900);
  });
});

describe('el clima al lado del número', () => {
  it('EL DÉFICIT HÍDRICO AVISA ANTES DE QUE ALGUIEN CONDENE AL POTRERO', () => {
    // Es la razón de ser de la etapa: sacar de la rotación un potrero que solo tuvo seca se paga
    // varios años.
    const r = computePaddockPerformance({ ...base, waterBalanceMm: -180, windows: [ventana(30, 300, 30)] });
    expect(r.water).toBe('deficit');
    expect(r.caveat).toMatch(/seca/i);
  });

  it('el balance se normaliza por día: −60 mm no es lo mismo en 15 días que en un año', () => {
    const corto = classifyWater(-60, 15); // −4 mm/día
    const largo = classifyWater(-60, 365); // −0,16 mm/día
    expect(corto).toBe('deficit');
    expect(largo).toBe('normal');
  });

  it('sin medición de balance NO se supone «normal»', () => {
    // Suponer normal es afirmar que llovió lo esperable sin haberlo medido, y con eso el aviso que
    // evita la decisión equivocada nunca aparece.
    expect(classifyWater(null, 90)).toBeNull();
    expect(computePaddockPerformance({ ...base, waterBalanceMm: null, windows: [ventana(30, 900, 30)] }).water).toBeNull();
  });

  it('el excedente también se nombra: encharcado tampoco produce', () => {
    expect(classifyWater(200, 90)).toBe('excedente');
  });

  it('el estrés calórico explica una caída sin culpar al potrero', () => {
    const r = computePaddockPerformance({ ...base, periodDays: 30, heatStressDays: 22, windows: [ventana(30, 400, 30)] });
    expect(r.caveat).toMatch(/estrés calórico/i);
  });

  it('EL ESTRÉS SE MIDE EN PROPORCIÓN, NO EN DÍAS SUELTOS', () => {
    // En el trópico 22 días de estrés en un año son normales; en tres semanas, no. Con un umbral
    // absoluto el aviso salía en casi todas las filas y dejaba de significar algo.
    const anual = computePaddockPerformance({ ...base, periodDays: 300, heatStressDays: 22, windows: [ventana(30, 1500, 45)] });
    expect(anual.caveat).toBeNull();
  });

  it('el aviso de estrés dice que NO explica la diferencia entre potreros', () => {
    // Viene de una sola estación: afecta igual a todo lo pastoreado en las mismas fechas. Leerlo
    // como la causa de que un potrero rinda menos que otro sería la conclusión equivocada.
    const r = computePaddockPerformance({ ...base, periodDays: 30, heatStressDays: 25, windows: [ventana(30, 400, 30)] });
    expect(r.caveat).toMatch(/no por qué este potrero rindió distinto/i);
  });

  it('con datos suficientes y clima normal no inventa una advertencia', () => {
    // Una pantalla que siempre muestra un aviso enseña a ignorarlos.
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, 1500, 45)] });
    expect(r.caveat).toBeNull();
  });
});

describe('confianza: los mismos cortes que el resto del sistema', () => {
  it('sube con la cantidad de animales medidos', () => {
    expect(performanceConfidence(0)).toBe('sin_datos');
    expect(performanceConfidence(9)).toBe('baja');
    expect(performanceConfidence(10)).toBe('media');
    expect(performanceConfidence(30)).toBe('alta');
  });

  it('con pocos animales lo dice en vez de mostrar el número a secas', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, 200, 4)] });
    expect(r.confidence).toBe('baja');
    expect(r.caveat).toMatch(/pocos animales/i);
  });

  it('el déficit hídrico pesa más que la advertencia por pocos animales', () => {
    // Las dos son ciertas, pero solo una cambia la decisión de sacar el potrero de la rotación.
    const r = computePaddockPerformance({ ...base, waterBalanceMm: -180, windows: [ventana(30, 200, 4)] });
    expect(r.caveat).toMatch(/seca/i);
  });
});

describe('el aviso viene clasificado para que la pantalla no lo repita', () => {
  it('el estrés calórico se marca como tal: la UI lo muestra UNA vez, no por fila', () => {
    // El propio texto dice que afecta a todos los potreros del período. Repetirlo fila por fila se
    // contradice con lo que dice.
    const r = computePaddockPerformance({ ...base, periodDays: 30, heatStressDays: 25, windows: [ventana(30, 400, 30)] });
    expect(r.caveatKind).toBe('estres');
  });

  it('el déficit y la falta de pesajes son de cada potrero, no del período', () => {
    expect(computePaddockPerformance({ ...base, waterBalanceMm: -180, windows: [ventana(30, 300, 30)] }).caveatKind).toBe('deficit');
    expect(computePaddockPerformance({ ...base, windows: [ventana(30, null, 0)] }).caveatKind).toBe('sin_datos');
  });

  it('sin aviso, la clase también es null: no hay una sin la otra', () => {
    const r = computePaddockPerformance({ ...base, windows: [ventana(30, 1500, 45)] });
    expect(r.caveat).toBeNull();
    expect(r.caveatKind).toBeNull();
  });
});
