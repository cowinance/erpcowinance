import { describe, it, expect } from 'vitest';
import { recortarAgenda, type GrupoDeAgenda } from './agenda-recorte';

const g = (key: string, n: number): GrupoDeAgenda<string> => ({
  key,
  label: key,
  list: Array.from({ length: n }, (_, i) => `${key}-${i + 1}`),
});

const nombres = (r: ReturnType<typeof recortarAgenda<string>>) => r.grupos.flatMap((x) => x.list);

describe('recorte de la agenda del inicio', () => {
  it('no toca nada cuando entra todo', () => {
    const entrada = [g('vencidos', 3), g('hoy', 2)];
    const r = recortarAgenda(entrada, 10);
    expect(r.ocultos).toBe(0);
    expect(r.total).toBe(5);
    expect(r.grupos).toBe(entrada); // misma referencia: no se copia por copiar
  });

  it('justo en el límite tampoco recorta', () => {
    const r = recortarAgenda([g('hoy', 10)], 10);
    expect(r.ocultos).toBe(0);
  });

  /**
   * El caso real que motivó esto: 3 vencidos y 56 próximos en una finca de 66 animales.
   * Los tres vencidos tienen que entrar enteros — son lo único que de verdad urge.
   */
  it('los vencidos entran completos aunque los próximos sean muchísimos', () => {
    const r = recortarAgenda([g('vencidos', 3), g('proximos', 56)], 10);
    expect(nombres(r)).toEqual([
      'vencidos-1',
      'vencidos-2',
      'vencidos-3',
      'proximos-1',
      'proximos-2',
      'proximos-3',
      'proximos-4',
      'proximos-5',
      'proximos-6',
      'proximos-7',
    ]);
    expect(r.ocultos).toBe(49);
    expect(r.total).toBe(59);
  });

  it('si el primer grupo ya llena el presupuesto, los demás ni se dibujan', () => {
    const r = recortarAgenda([g('vencidos', 20), g('hoy', 5)], 10);
    expect(r.grupos.map((x) => x.key)).toEqual(['vencidos']);
    expect(nombres(r)).toHaveLength(10);
    expect(r.ocultos).toBe(15);
  });

  it('no deja grupos vacíos dibujados', () => {
    const r = recortarAgenda([g('vencidos', 10), g('hoy', 3)], 10);
    expect(r.grupos.every((x) => x.list.length > 0)).toBe(true);
  });

  it('no muta los grupos recibidos', () => {
    const entrada = [g('vencidos', 3), g('proximos', 56)];
    recortarAgenda(entrada, 10);
    expect(entrada[1].list).toHaveLength(56);
  });

  it('un límite de cero o negativo se interpreta como «sin recorte»', () => {
    const entrada = [g('hoy', 40)];
    expect(recortarAgenda(entrada, 0).ocultos).toBe(0);
    expect(recortarAgenda(entrada, -5).ocultos).toBe(0);
  });

  it('con la agenda vacía no rompe', () => {
    const r = recortarAgenda<string>([], 10);
    expect(r).toEqual({ grupos: [], ocultos: 0, total: 0 });
  });
});
