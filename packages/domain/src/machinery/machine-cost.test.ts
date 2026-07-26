import { describe, expect, it } from 'vitest';
import { computeMachineCost, groupMachinesByMeter, usageFromReadings } from './machine-cost';

const base = { hourReadings: [1000, 1200], kmReadings: [], fuelCost: 800, fuelLiters: 400, preventiveCost: 200, correctiveCost: 0 };

describe('costo por hora de uso', () => {
  it('reparte el gasto del período sobre las horas trabajadas', () => {
    const r = computeMachineCost(base);
    expect(r.usage).toBe(200); // 1200 − 1000
    expect(r.totalCost).toBe(1000); // 800 de gasoil + 200 de service
    expect(r.costPerUnit).toBe(5);
    expect(r.meter).toBe('hours');
  });

  it('el consumo por hora sale del mismo uso', () => {
    // Es el número que sube primero cuando el motor empieza a fallar.
    expect(computeMachineCost(base).fuelPerUnit).toBe(2); // 400 l / 200 h
  });

  it('el camión se mide en KILÓMETROS, no en horas', () => {
    // Un «costo por hora» de camión no significa nada, y encima se compararía de mentira contra el
    // del tractor.
    const r = computeMachineCost({ ...base, hourReadings: [], kmReadings: [40000, 45000] });
    expect(r.meter).toBe('km');
    expect(r.usage).toBe(5000);
    expect(r.costPerUnit).toBe(0.2);
  });

  it('con los dos medidores cargados manda el horómetro', () => {
    const r = computeMachineCost({ ...base, kmReadings: [100, 900] });
    expect(r.meter).toBe('hours');
    expect(r.usage).toBe(200);
  });
});

describe('sin lecturas del medidor no se inventa un costo unitario', () => {
  it('UNA SOLA LECTURA NO ALCANZA: no hay uso que dividir', () => {
    // El peor resultado posible sería devolver el costo total disfrazado de costo por hora: se ve
    // razonable y está mal.
    const r = computeMachineCost({ ...base, hourReadings: [1000] });
    expect(r.usage).toBeNull();
    expect(r.costPerUnit).toBeNull();
    expect(r.totalCost).toBe(1000); // el gasto sí se informa
    expect(r.caveat).toMatch(/anotar el medidor/i);
  });

  it('el medidor que no se movió es un número copiado, no trabajo cero', () => {
    // Dividir por cero daría infinito; suponer que trabajó es peor todavía.
    expect(usageFromReadings([1500, 1500, 1500])).toBeNull();
  });

  it('descarta lecturas imposibles en vez de restarlas', () => {
    expect(usageFromReadings([0, -5, 1200, 1000])).toBe(200);
  });

  it('sin gasto ni lecturas lo dice sin alarmar', () => {
    const r = computeMachineCost({ hourReadings: [], kmReadings: [], fuelCost: 0, fuelLiters: 0, preventiveCost: 0, correctiveCost: 0 });
    expect(r.caveat).toMatch(/sin gasto ni lecturas/i);
  });
});

describe('el correctivo es la señal, no el costo total', () => {
  it('DOS MÁQUINAS CON EL MISMO COSTO POR HORA NO SON LA MISMA MÁQUINA', () => {
    // Una gasta en service programado, la otra en roturas. El costo por hora las iguala; la
    // proporción de correctivo es lo que anticipa el problema.
    const cuidada = computeMachineCost({ ...base, preventiveCost: 200, correctiveCost: 0 });
    const rota = computeMachineCost({ ...base, preventiveCost: 0, correctiveCost: 200 });
    expect(rota.costPerUnit).toBe(cuidada.costPerUnit);
    expect(rota.correctiveSharePct).toBe(100);
    expect(rota.caveat).toMatch(/rotura/i);
    expect(cuidada.caveat).toBeNull();
  });

  it('sin mantenimiento en el período la proporción es null, no 0%', () => {
    // 0% significa «hubo gasto y todo fue programado». Es otra cosa.
    const r = computeMachineCost({ ...base, preventiveCost: 0, correctiveCost: 0 });
    expect(r.correctiveSharePct).toBeNull();
  });

  it('el umbral está documentado: la mitad justa no dispara el aviso', () => {
    const r = computeMachineCost({ ...base, preventiveCost: 100, correctiveCost: 100 });
    expect(r.correctiveSharePct).toBe(50);
    expect(r.caveat).toBeNull();
  });
});

describe('comparar máquinas entre sí', () => {
  const maquina = (name: string, cost: ReturnType<typeof computeMachineCost>) => ({ name, cost });

  it('NUNCA mezcla horas con kilómetros en el mismo ranking', () => {
    // Un orden con apariencia de sentido y sin ninguno es peor que no ordenar.
    const g = groupMachinesByMeter([
      maquina('Tractor', computeMachineCost(base)),
      maquina('Camión', computeMachineCost({ ...base, hourReadings: [], kmReadings: [40000, 45000] })),
    ]);
    expect(g.hours.map((m) => m.name)).toEqual(['Tractor']);
    expect(g.km.map((m) => m.name)).toEqual(['Camión']);
  });

  it('las que no se pudieron medir van aparte, no al fondo del ranking', () => {
    // No son las más baratas: son las que nadie anotó.
    const g = groupMachinesByMeter([
      maquina('Medida', computeMachineCost(base)),
      maquina('Sin medir', computeMachineCost({ ...base, hourReadings: [] })),
    ]);
    expect(g.unmeasured.map((m) => m.name)).toEqual(['Sin medir']);
    expect(g.hours.map((m) => m.name)).toEqual(['Medida']);
  });

  it('ordena de la más cara a la más barata: la conversación empieza por arriba', () => {
    const g = groupMachinesByMeter([
      maquina('Barata', computeMachineCost({ ...base, fuelCost: 200, preventiveCost: 0 })),
      maquina('Cara', computeMachineCost({ ...base, fuelCost: 3000, preventiveCost: 0 })),
    ]);
    expect(g.hours.map((m) => m.name)).toEqual(['Cara', 'Barata']);
  });
});
