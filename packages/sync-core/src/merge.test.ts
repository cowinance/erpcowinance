import { describe, it, expect } from 'vitest';
import { applyPut, detectTerminalStatusConflict } from './merge';
import { hlcEncode } from './hlc';
import { PutOp, RowState } from './types';

const hlc = (ms: number, node: string, count = 0) => hlcEncode({ ms, count, node });
const put = (fields: Record<string, unknown>, h: string): PutOp => ({ kind: 'put', table: 'animals', rowId: 'a1', fields, hlc: h });

describe('applyPut · LWW por campo', () => {
  it('escribe campos nuevos y los reporta en changed', () => {
    const { state, changed } = applyPut(undefined, put({ name: 'Estrella', status: 'active' }, hlc(100, 'a')));
    expect(state.fields).toEqual({ name: 'Estrella', status: 'active' });
    expect(changed.sort()).toEqual(['name', 'status']);
  });

  it('el HLC mayor gana; el menor se ignora', () => {
    let st = applyPut(undefined, put({ name: 'A' }, hlc(100, 'x'))).state;
    st = applyPut(st, put({ name: 'B' }, hlc(200, 'y'))).state; // mayor → gana
    expect(st.fields.name).toBe('B');
    const r = applyPut(st, put({ name: 'C' }, hlc(150, 'z'))); // menor → ignorado
    expect(r.state.fields.name).toBe('B');
    expect(r.changed).toEqual([]);
  });

  it('es conmutativa: aplicar en cualquier orden da el mismo estado (convergencia)', () => {
    const op1 = put({ name: 'A', lote: 'L1' }, hlc(100, 'x'));
    const op2 = put({ name: 'B' }, hlc(200, 'y'));
    const forward = applyPut(applyPut(undefined, op1).state, op2).state;
    const backward = applyPut(applyPut(undefined, op2).state, op1).state;
    expect(forward).toEqual(backward);
    expect(forward.fields).toEqual({ name: 'B', lote: 'L1' });
  });

  it('es pura: no muta el estado de entrada', () => {
    const original: RowState = { fields: { name: 'A' }, versions: { name: hlc(100, 'x') } };
    const snapshot = JSON.parse(JSON.stringify(original));
    applyPut(original, put({ name: 'B' }, hlc(200, 'y')));
    expect(original).toEqual(snapshot);
  });
});

describe('detectTerminalStatusConflict', () => {
  const withStatus = (status: string, h: string): RowState => ({ fields: { status }, versions: { status: h } });

  it('null si el estado entrante no es terminal', () => {
    expect(detectTerminalStatusConflict(withStatus('dead', hlc(1, 'a')), put({ status: 'active' }, hlc(2, 'b')))).toBeNull();
  });

  it('null si el estado previo no es terminal', () => {
    expect(detectTerminalStatusConflict(withStatus('active', hlc(1, 'a')), put({ status: 'sold' }, hlc(2, 'b')))).toBeNull();
  });

  it('null si ambos vienen del mismo nodo (no es concurrente)', () => {
    expect(detectTerminalStatusConflict(withStatus('dead', hlc(1, 'a')), put({ status: 'sold' }, hlc(2, 'a')))).toBeNull();
  });

  it('detecta dos estados terminales de nodos distintos', () => {
    const msg = detectTerminalStatusConflict(withStatus('dead', hlc(1, 'a')), put({ status: 'sold' }, hlc(2, 'b')));
    expect(msg).toMatch(/dead/);
    expect(msg).toMatch(/sold/);
  });
});
