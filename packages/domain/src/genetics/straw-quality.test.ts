import { describe, expect, it } from 'vitest';
import { MIN_POST_THAW_MOTILITY_PCT, batchUsability, motilityVerdict } from './straw-quality';

const HOY = '2026-07-28';

describe('motilidad post-descongelado', () => {
  it('30% o más es apta para inseminar', () => {
    expect(motilityVerdict(60)).toBe('apta');
    expect(motilityVerdict(MIN_POST_THAW_MOTILITY_PCT)).toBe('apta');
  });

  it('ENTRE 15% Y 30% ES DUDOSA, NO DESCARTE', () => {
    // El matiz no es tibieza: esa partida todavía puede preñar, con peor tasa. Con un apto/no-apto
    // el productor tiraría semen que le sirve para vacas de descarte.
    expect(motilityVerdict(25)).toBe('dudosa');
    expect(motilityVerdict(15)).toBe('dudosa');
  });

  it('por debajo de 15% no hay discusión', () => {
    expect(motilityVerdict(10)).toBe('descartar');
    expect(motilityVerdict(0)).toBe('descartar');
  });

  it('el umbral se puede mover sin tocar la medición', () => {
    // Cada laboratorio y cada raza pueden tener el suyo.
    expect(motilityVerdict(35, 40)).toBe('dudosa');
    expect(motilityVerdict(35, 30)).toBe('apta');
  });
});

describe('si la partida sirve o no', () => {
  it('UNA PARTIDA SIN PRUEBA NO ES UN PROBLEMA', () => {
    // Lo normal: la mayoría del semen nunca se prueba y anda perfecto. Avisar por no haberlo probado
    // convertiría el aviso en ruido, y la próxima vez que diga algo de verdad nadie lo va a leer.
    const r = batchUsability({ today: HOY });
    expect(r.level).toBe('ok');
    expect(r.blocks).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBeNull();
  });

  it('EL TIEMPO SOLO NO ARRUINA NADA: sin vencimiento declarado, una partida vieja está OK', () => {
    // A −196 °C el semen dura décadas. Un aviso de «vencido» por antigüedad sería inventar un
    // problema — y enseñar a ignorar los avisos.
    const r = batchUsability({ today: HOY, expiryDate: null, lastCheck: { checkedAt: '2010-01-01', motilityPct: 65 } });
    expect(r.level).toBe('ok');
  });

  it('una prueba MALA bloquea el uso', () => {
    // El caso que esto existe para evitar: inseminar cincuenta vacas con semen muerto y enterarse a
    // los sesenta días, cuando el diagnóstico da todo vacío.
    const r = batchUsability({ today: HOY, lastCheck: { checkedAt: '2026-07-01', motilityPct: 8 } });
    expect(r.blocks).toBe(true);
    expect(r.level).toBe('blocked');
    expect(r.reasons[0]).toContain('8%');
  });

  it('una prueba dudosa avisa pero no bloquea', () => {
    const r = batchUsability({ today: HOY, lastCheck: { checkedAt: '2026-07-01', motilityPct: 22 } });
    expect(r.blocks).toBe(false);
    expect(r.level).toBe('warning');
    expect(r.reasons[0]).toContain('peor tasa');
  });

  it('EL PERMISO VENCIDO NO DICE QUE EL SEMEN ESTÉ MALO', () => {
    // La distinción importa: si el mensaje dijera «semen vencido», el productor tiraría pajuelas
    // perfectamente buenas. Lo que caducó es un papel.
    const r = batchUsability({ today: HOY, expiryDate: '2026-06-01' });
    expect(r.blocks).toBe(true);
    expect(r.reasons[0]).toContain('Permiso vencido');
    expect(r.reasons[0]).toContain('sigue siendo buena');
    expect(r.daysToExpiry).toBe(-57);
  });

  it('avisa con anticipación, porque un trámite lleva tiempo', () => {
    const r = batchUsability({ today: HOY, expiryDate: '2026-08-30' });
    expect(r.level).toBe('warning');
    expect(r.blocks).toBe(false);
    expect(r.daysToExpiry).toBe(33);
  });

  it('un vencimiento lejano no dice nada', () => {
    const r = batchUsability({ today: HOY, expiryDate: '2028-01-01' });
    expect(r.level).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  it('acumula los dos motivos cuando los dos aplican', () => {
    const r = batchUsability({ today: HOY, expiryDate: '2026-06-01', lastCheck: { checkedAt: '2026-07-01', motilityPct: 5 } });
    expect(r.reasons).toHaveLength(2);
    expect(r.blocks).toBe(true);
  });
});
