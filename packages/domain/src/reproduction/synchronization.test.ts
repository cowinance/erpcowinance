import { describe, expect, it } from 'vitest';
import { MIN_SYNC_SAMPLE, computeSyncResponse } from './synchronization';

describe('respuesta a la sincronización', () => {
  it('CONTESTA CUÁNTAS RECEPTORAS PREPARAR PARA COLOCAR UN EMBRIÓN', () => {
    // La razón práctica de medir esto. Si responde la mitad y el productor sincroniza 20 vacas para
    // 20 embriones, diez embriones se quedan un año más en el termo.
    const r = computeSyncResponse({ checked: 20, responded: 10 });
    expect(r.ratePct).toBe(50);
    expect(r.recipientsPerEmbryo).toBe(2);
  });

  it('cuenta las que no respondieron', () => {
    const r = computeSyncResponse({ checked: 12, responded: 9 });
    expect(r.notResponded).toBe(3);
    expect(r.ratePct).toBe(75);
  });

  it('CON MUESTRA CHICA NO PUBLICA UN PORCENTAJE, Y DICE POR QUÉ', () => {
    // Con tres receptoras, una que falla da 67% y dos dan 33%: el número salta treinta puntos por un
    // animal. Mostrar eso invita a decidir sobre ruido.
    const r = computeSyncResponse({ checked: 3, responded: 2 });
    expect(r.ratePct).toBeNull();
    expect(r.checked, 'los conteos crudos SÍ se muestran').toBe(3);
    expect(r.responded).toBe(2);
    expect(r.caveat).toContain(String(MIN_SYNC_SAMPLE));
  });

  it('justo en el mínimo ya publica', () => {
    expect(computeSyncResponse({ checked: MIN_SYNC_SAMPLE, responded: 4 }).ratePct).toBe(50);
  });

  it('NINGUNA RESPUESTA NO ES UNA DIVISIÓN POR CERO: es un aviso', () => {
    // «Infinitas receptoras por embrión» no le dice nada a nadie; que el protocolo falló, sí.
    const r = computeSyncResponse({ checked: 10, responded: 0 });
    expect(r.ratePct).toBe(0);
    expect(r.recipientsPerEmbryo).toBeNull();
    expect(r.caveat).toContain('protocolo');
  });

  it('sin revisar ninguna no inventa nada', () => {
    const r = computeSyncResponse({ checked: 0, responded: 0 });
    expect(r.ratePct).toBeNull();
    expect(r.caveat).toContain('ninguna');
  });

  it('no deja que respondan más de las revisadas', () => {
    // Un dato imposible entra igual por una carga mal hecha; que dé 150% sería peor que acotarlo.
    const r = computeSyncResponse({ checked: 10, responded: 25 });
    expect(r.responded).toBe(10);
    expect(r.ratePct).toBe(100);
    expect(r.notResponded).toBe(0);
  });
});
