import { describe, expect, it } from 'vitest';
import { summarizeLaborByActivity } from './labor-by-activity';

const fila = (activity: string | null, pricedHours: number, cost: number, unpricedHours = 0) => ({ activity, pricedHours, cost, unpricedHours });

describe('en qué se va la mano de obra', () => {
  it('reparte el costo total entre las actividades', () => {
    const r = summarizeLaborByActivity([fila('health', 100, 800), fila('feeding', 100, 1200)]);
    expect(r.totals.cost).toBe(2000);
    expect(r.rows.find((x) => x.activity === 'feeding')!.sharePct).toBe(60);
    expect(r.rows.find((x) => x.activity === 'health')!.sharePct).toBe(40);
  });

  it('el costo por hora difiere entre actividades: no las hace la misma gente', () => {
    // Es la mitad del argumento para tercerizar: no alcanza con las horas, importa quién las hace.
    const r = summarizeLaborByActivity([fila('health', 50, 900), fila('feeding', 200, 1600)]);
    expect(r.rows.find((x) => x.activity === 'health')!.costPerHour).toBe(18);
    expect(r.rows.find((x) => x.activity === 'feeding')!.costPerHour).toBe(8);
  });

  it('ordena por costo: la conversación empieza por lo que más pesa', () => {
    const r = summarizeLaborByActivity([fila('health', 10, 100), fila('maintenance', 10, 900), fila('crop', 10, 400)]);
    expect(r.rows.map((x) => x.activity)).toEqual(['maintenance', 'crop', 'health']);
  });
});

describe('el aviso que evita la conclusión al revés', () => {
  it('UNA ACTIVIDAD CON POCA COBERTURA SE VE MÁS BARATA DE LO QUE ES', () => {
    // El riesgo entero de la etapa: si media actividad la hace gente sin tarifa cargada, el costo
    // sale bajo y la conclusión —«nos conviene hacerlo nosotros»— sale invertida.
    const r = summarizeLaborByActivity([fila('maintenance', 20, 200, 80)]);
    const m = r.rows[0];
    expect(m.coveragePct).toBe(20);
    expect(m.caveat).toMatch(/por debajo del real/i);
  });

  it('con toda la cobertura no inventa una advertencia', () => {
    // Un aviso en cada fila se aprende a saltear, y entonces el que importa tampoco se lee.
    const r = summarizeLaborByActivity([fila('health', 100, 800)]);
    expect(r.rows[0].coveragePct).toBe(100);
    expect(r.rows[0].caveat).toBeNull();
  });

  it('el umbral de cobertura no es una constante escondida', () => {
    // 85% no avisa, 75% sí: el corte está documentado y es una convención de lectura.
    expect(summarizeLaborByActivity([fila('health', 85, 850, 15)]).rows[0].caveat).toBeNull();
    expect(summarizeLaborByActivity([fila('health', 75, 750, 25)]).rows[0].caveat).not.toBeNull();
  });

  it('las horas sin tarifa NO se valorizan a cero: se cuentan aparte', () => {
    // Contarlas a cero sería afirmar que ese trabajo fue gratis.
    const r = summarizeLaborByActivity([fila('health', 10, 100, 40)]);
    expect(r.rows[0].hours).toBe(50);
    expect(r.rows[0].cost).toBe(100);
    expect(r.totals.unpricedHours).toBe(40);
  });
});

describe('las jornadas sin tarea no son una actividad más', () => {
  it('van SIEMPRE al final, aunque cuesten más que todas', () => {
    // Ordenadas por costo quedarían primeras y se leerían como «acá se va la plata», cuando lo que
    // dicen es «no se sabe en qué se fue».
    const r = summarizeLaborByActivity([fila('health', 10, 100), fila(null, 500, 9000)]);
    expect(r.rows[r.rows.length - 1].activity).toBeNull();
  });

  it('se informan como lo que son: un dato que falta', () => {
    const r = summarizeLaborByActivity([fila('health', 10, 100), fila(null, 20, 300)]);
    expect(r.rows.find((x) => x.activity === null)!.caveat).toMatch(/no se sabe en qué se fueron/i);
    expect(r.totals.hoursWithoutActivity).toBe(20);
  });
});

describe('bordes que no se pueden convertir en un número inventado', () => {
  it('sin costo total no reparte porcentajes', () => {
    // Un 100% sobre cero se leería como «acá se va todo».
    const r = summarizeLaborByActivity([fila('health', 0, 0, 30)]);
    expect(r.rows[0].sharePct).toBeNull();
    expect(r.rows[0].costPerHour).toBeNull();
  });

  it('sin ninguna jornada devuelve totales en cero, no NaN', () => {
    const r = summarizeLaborByActivity([]);
    expect(r.rows).toEqual([]);
    expect(r.totals).toMatchObject({ hours: 0, cost: 0, coveragePct: 0 });
  });

  it('números basura no se propagan', () => {
    const r = summarizeLaborByActivity([{ activity: 'health', pricedHours: Number.NaN, cost: -5, unpricedHours: -3 }]);
    expect(r.totals.hours).toBe(0);
    expect(r.totals.cost).toBe(0);
  });
});
