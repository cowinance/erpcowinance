import { describe, expect, it } from 'vitest';
import { computeStockRotation, DEFAULT_LEAD_TIME_DAYS } from './stock-rotation';

const base = { stock: 300, consumed: 900, periodDays: 90, avgCost: 10 };

describe('para cuántos días alcanza', () => {
  it('proyecta la cobertura al ritmo del período', () => {
    const r = computeStockRotation(base); // 10 por día, 300 de saldo
    expect(r.dailyUse).toBe(10);
    expect(r.coverageDays).toBe(30);
  });

  it('DERIVA EL PUNTO DE REPOSICIÓN DEL CONSUMO REAL', () => {
    // Es el hueco silencioso que tapa: la alerta de stock bajo depende de un mínimo cargado a mano,
    // y en el ítem donde nadie lo cargó no suena NUNCA.
    const r = computeStockRotation(base, { leadTimeDays: 15 });
    expect(r.suggestedReorderPoint).toBe(150); // 10 por día × 15 de reposición
  });

  it('el tiempo de reposición es un parámetro, no una constante escondida', () => {
    expect(DEFAULT_LEAD_TIME_DAYS).toBe(30);
    expect(computeStockRotation(base).suggestedReorderPoint).toBe(300);
    expect(computeStockRotation(base, { leadTimeDays: 60 }).suggestedReorderPoint).toBe(600);
  });

  it('marca crítico lo que se termina antes de que llegue la reposición', () => {
    const r = computeStockRotation({ ...base, stock: 100 }, { leadTimeDays: 30 }); // alcanza 10 días
    expect(r.status).toBe('critico');
    expect(r.caveat).toMatch(/se termina antes de que llegue/i);
  });

  it('sin saldo lo dice sin rodeos', () => {
    const r = computeStockRotation({ ...base, stock: 0 });
    expect(r.status).toBe('sin_stock');
  });
});

describe('lo que no se usa es plata quieta, no stock de sobra', () => {
  it('SIN CONSUMO LA COBERTURA NO ES INFINITA: ES SIN DATOS', () => {
    // Un cero por día daría cobertura infinita y el ítem se leería como «tengo de sobra», cuando lo
    // que pasa es que no se usa. Es la diferencia entre stock y capital parado.
    const r = computeStockRotation({ ...base, consumed: 0 });
    expect(r.dailyUse).toBeNull();
    expect(r.coverageDays).toBeNull();
    expect(r.status).toBe('dormido');
  });

  it('pone número a la plata quieta', () => {
    const r = computeStockRotation({ ...base, consumed: 0, daysSinceMovement: 200 });
    expect(r.stockValue).toBe(3000); // 300 × 10
    expect(r.caveat).toMatch(/6 meses sin ningún movimiento/i);
    expect(r.caveat).toMatch(/3000 quietos/);
  });

  it('sin costo cargado informa el saldo pero no inventa un valor', () => {
    const r = computeStockRotation({ ...base, avgCost: null });
    expect(r.stock).toBe(300);
    expect(r.stockValue).toBeNull();
  });
});

describe('el mínimo cargado a mano que quedó viejo', () => {
  it('avisa cuando es tan alto que la alerta saltaría siempre', () => {
    // Una alerta que salta siempre se aprende a ignorar, y con ella la vez que importa.
    const r = computeStockRotation({ ...base, reorderPoint: 900 }, { leadTimeDays: 30 }); // sugerido 300
    expect(r.caveat).toMatch(/va a saltar casi siempre/i);
  });

  it('avisa cuando quedó corto y el aviso llegaría tarde', () => {
    const r = computeStockRotation({ ...base, reorderPoint: 50 }, { leadTimeDays: 30 });
    expect(r.caveat).toMatch(/llegaría tarde/i);
  });

  it('una diferencia chica es ruido del período, no un número viejo', () => {
    // Avisar por cada desvío convertiría el aviso en decoración.
    const r = computeStockRotation({ ...base, reorderPoint: 350 }, { leadTimeDays: 30 }); // sugerido 300
    expect(r.caveat).toBeNull();
  });

  it('sin mínimo cargado no reclama nada: el sugerido ya está ahí', () => {
    const r = computeStockRotation(base);
    expect(r.caveat).toBeNull();
    expect(r.suggestedReorderPoint).toBe(300);
  });
});

describe('bordes que no se convierten en un número inventado', () => {
  it('sin período no proyecta', () => {
    const r = computeStockRotation({ ...base, periodDays: 0 });
    expect(r.dailyUse).toBeNull();
    expect(r.suggestedReorderPoint).toBeNull();
  });

  it('números basura no se propagan', () => {
    const r = computeStockRotation({ stock: Number.NaN, consumed: -50, periodDays: 90, avgCost: -3 });
    expect(r.stock).toBe(0);
    expect(r.consumed).toBe(0);
    expect(r.status).toBe('sin_stock');
  });

  it('las vueltas por año se calculan sobre el saldo actual y se dicen como tales', () => {
    const r = computeStockRotation({ ...base, stock: 100 }); // 10/día sobre 100 de saldo
    expect(r.turnsPerYear).toBe(36.5);
  });
});
