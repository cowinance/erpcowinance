import { describe, expect, it } from 'vitest';
import { validateQuickAdd } from './quick-add';

const OK = { tag: '801', sex: 'F' as const, categoryCode: 'vaquillona' };

describe('alta rápida de un animal', () => {
  it('con los tres datos guarda sin ruido', () => {
    const r = validateQuickAdd(OK, [{ tag: '800', status: 'active' }]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.tag).toBe('801');
  });

  it('sin caravana, sin sexo o sin categoría NO se puede guardar', () => {
    expect(validateQuickAdd({ ...OK, tag: '   ' }).errors.map((e) => e.field)).toEqual(['tag']);
    expect(validateQuickAdd({ ...OK, sex: null }).errors.map((e) => e.field)).toEqual(['sex']);
    expect(validateQuickAdd({ ...OK, categoryCode: null }).errors.map((e) => e.field)).toEqual(['category']);
  });

  it('DEVUELVE la caravana normalizada, no la tipeada', () => {
    // Guardar ' 801 ' crearía un animal que después no aparece al buscar '801'. La normalización es
    // del VO, que es donde vive esa regla.
    expect(validateQuickAdd({ ...OK, tag: '  801  ' }).tag).toBe('801');
  });

  it('la caravana repetida AVISA pero deja guardar', () => {
    // Misma semántica que el servidor: AnimalSyncHandler acepta el alta y registra un conflicto
    // `duplicate` como propuesta de fusión. Bloquear acá sería más duro que el servidor y dejaría al
    // productor trabado en el corral.
    const r = validateQuickAdd(OK, [{ tag: '801', status: 'active' }]);
    expect(r.errors, 'no bloquea').toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/ya la tiene un animal activo/);
  });

  it('si el otro animal YA NO ESTÁ, el aviso es distinto', () => {
    // Reusar la caravana de un animal muerto es práctica normal de campo; decirle lo mismo que para
    // uno activo lo entrenaría a ignorar el aviso.
    for (const status of ['dead', 'sold', 'culled']) {
      const r = validateQuickAdd(OK, [{ tag: '801', status }]);
      expect(r.warnings[0].message, status).toMatch(/ya no está en el rodeo/);
    }
  });

  it('compara contra la caravana NORMALIZADA del otro', () => {
    // Si el duplicado se escapa por un espacio, el aviso no sirve para nada.
    expect(validateQuickAdd(OK, [{ tag: ' 801 ', status: 'active' }]).warnings).toHaveLength(1);
  });

  it('avisa UNA vez aunque la caravana esté repetida en varios', () => {
    const r = validateQuickAdd(OK, [
      { tag: '801', status: 'active' },
      { tag: '801', status: 'dead' },
    ]);
    expect(r.warnings).toHaveLength(1);
  });

  it('sin caravana de un lado ni del otro NO se avisa de repetida', () => {
    // Una cría cargada en un parto sin caravana tiene tag null, y son muchas. Si el vacío contara
    // como coincidencia, el productor que todavía no tipeó la caravana vería «repetida» desde el
    // primer instante, y el aviso dejaría de significar algo.
    //
    // El caso hay que armarlo con el animal nuevo TAMBIÉN sin caravana: con una caravana escrita,
    // el vacío del otro nunca coincide y el test pasaría sin probar nada.
    const r = validateQuickAdd({ ...OK, tag: '' }, [{ tag: null }, { tag: '' }, { tag: undefined }]);
    expect(r.warnings, 'el vacío no es una coincidencia').toEqual([]);
    expect(r.errors.map((e) => e.field), 'lo que sí falta es la caravana').toEqual(['tag']);
  });

  it('sin nada bajado todavía, no explota', () => {
    expect(validateQuickAdd(OK).warnings).toEqual([]);
  });
});
