import { describe, it, expect } from 'vitest';
import { hlcEncode, hlcParse, hlcNode, hlcCompare, HlcClock } from './hlc';

describe('HLC · codificación', () => {
  it('round-trip encode/parse', () => {
    const parts = { ms: 1780000000000, count: 42, node: 'dev-a' };
    expect(hlcParse(hlcEncode(parts))).toEqual(parts);
  });

  it('ms en 14 dígitos y contador en 6 hex', () => {
    expect(hlcEncode({ ms: 5, count: 255, node: 'n' })).toBe('00000000000005:0000ff:n');
  });

  it('hlcNode extrae el nodo (incluso si el node tiene guiones)', () => {
    expect(hlcNode(hlcEncode({ ms: 1, count: 1, node: 'dev-a-1' }))).toBe('dev-a-1');
  });
});

describe('HLC · orden total (ms → contador → nodo)', () => {
  const enc = (ms: number, count: number, node: string) => hlcEncode({ ms, count, node });

  it('ordena primero por ms', () => {
    expect(hlcCompare(enc(1, 9, 'z'), enc(2, 0, 'a'))).toBe(-1);
  });
  it('a igual ms, ordena por contador', () => {
    expect(hlcCompare(enc(5, 1, 'z'), enc(5, 2, 'a'))).toBe(-1);
  });
  it('a igual ms y contador, ordena por nodo', () => {
    expect(hlcCompare(enc(5, 3, 'a'), enc(5, 3, 'b'))).toBe(-1);
    expect(hlcCompare(enc(5, 3, 'b'), enc(5, 3, 'b'))).toBe(0);
  });

  it('el orden lexicográfico del string coincide con el orden lógico', () => {
    const items = [enc(2, 0, 'a'), enc(1, 5, 'z'), enc(1, 0, 'b'), enc(1, 5, 'a')];
    const byString = [...items].sort();
    const byCompare = [...items].sort(hlcCompare);
    expect(byString).toEqual(byCompare);
  });
});

describe('HLC · reloj', () => {
  it('tick con misma hora de pared incrementa el contador', () => {
    const clock = new HlcClock('n', () => 1000);
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 1000, count: 0 });
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 1000, count: 1 });
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 1000, count: 2 });
  });

  it('tick que avanza la hora de pared resetea el contador', () => {
    let wall = 1000;
    const clock = new HlcClock('n', () => wall);
    clock.tick();
    clock.tick(); // count = 1
    wall = 2000;
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 2000, count: 0 });
  });

  it('receive con remoto adelantado adopta su ms; el tick siguiente avanza el contador', () => {
    const clock = new HlcClock('n', () => 1000);
    clock.receive(hlcEncode({ ms: 5000, count: 7, node: 'otro' })); // lastMs=5000, count=8
    // La hora de pared (1000) no supera a lastMs, así que tick incrementa: 8 → 9
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 5000, count: 9 });
  });

  it('receive con remoto en el mismo ms toma el máximo contador +1', () => {
    const clock = new HlcClock('n', () => 1000);
    clock.tick(); // ms 1000 count 0
    clock.receive(hlcEncode({ ms: 1000, count: 4, node: 'otro' }));
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 1000, count: 6 });
  });

  it('la hora de pared adelantada domina a ambos', () => {
    let wall = 1000;
    const clock = new HlcClock('n', () => wall);
    clock.tick();
    wall = 9000;
    clock.receive(hlcEncode({ ms: 5000, count: 3, node: 'otro' }));
    expect(hlcParse(clock.tick())).toMatchObject({ ms: 9000, count: 1 });
  });

  it('el tiempo lógico nunca retrocede', () => {
    let wall = 5000;
    const clock = new HlcClock('n', () => wall);
    const a = clock.tick();
    wall = 1000; // reloj de pared retrocede
    clock.receive(hlcEncode({ ms: 500, count: 0, node: 'otro' }));
    const b = clock.tick();
    expect(hlcCompare(b, a)).toBe(1);
  });
});
