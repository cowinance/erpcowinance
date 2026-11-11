import { describe, it, expect, vi } from 'vitest';
import { decidirCambioDeFinca, decidirIngreso } from './session-rules';

/** Contador espiable: sirve para afirmar también CUÁNDO no se cuenta. */
const contador = (n: number) => vi.fn(async () => n);

describe('decidirIngreso', () => {
  it('sin base previa no hay nada que proteger', async () => {
    const contar = contador(99);
    expect(await decidirIngreso({ storeExistente: false, mismoDueno: false, contarPendientes: contar })).toEqual({
      accion: 'seguir',
    });
    expect(contar).not.toHaveBeenCalled();
  });

  it('la misma cuenta entra sin tocar la base, aunque tenga cosas en cola', async () => {
    const contar = contador(7);
    expect(await decidirIngreso({ storeExistente: true, mismoDueno: true, contarPendientes: contar })).toEqual({
      accion: 'seguir',
    });
    // Restaurar el store para contar sería trabajo tirado en el camino más común: volver a entrar.
    expect(contar).not.toHaveBeenCalled();
  });

  /** El escenario que esto existe para impedir: entrar con otra cuenta sobre trabajo sin subir. */
  it('otra cuenta con trabajo en cola queda bloqueada y se le dice cuánto hay', async () => {
    const d = await decidirIngreso({ storeExistente: true, mismoDueno: false, contarPendientes: contador(3) });
    expect(d.accion).toBe('bloquear');
    expect(d.accion === 'bloquear' && d.mensaje).toContain('3 cambios sin sincronizar de otra cuenta');
  });

  it('con un solo cambio lo dice en singular', async () => {
    const d = await decidirIngreso({ storeExistente: true, mismoDueno: false, contarPendientes: contador(1) });
    expect(d.accion === 'bloquear' && d.mensaje).toContain('1 cambio sin sincronizar');
  });

  it('otra cuenta sin nada en cola descarta la base y arranca limpia', async () => {
    expect(await decidirIngreso({ storeExistente: true, mismoDueno: false, contarPendientes: contador(0) })).toEqual({
      accion: 'descartar',
    });
  });
});

describe('decidirCambioDeFinca', () => {
  const fincas = [{ tenant_id: 'f1' }, { tenant_id: 'f2' }];

  it('una finca fuera de la lista se rechaza sin tocar el disco', async () => {
    const contar = contador(0);
    const d = await decidirCambioDeFinca({
      organizaciones: fincas,
      fincaActual: 'f1',
      destino: 'ajena',
      contarPendientes: contar,
    });
    expect(d).toEqual({ accion: 'bloquear', mensaje: 'No tenés acceso a esa finca.' });
    expect(contar).not.toHaveBeenCalled();
  });

  it('cambiar a la finca en la que ya estás no hace nada', async () => {
    const contar = contador(5);
    expect(
      await decidirCambioDeFinca({ organizaciones: fincas, fincaActual: 'f1', destino: 'f1', contarPendientes: contar }),
    ).toEqual({ accion: 'seguir' });
    expect(contar).not.toHaveBeenCalled();
  });

  /**
   * Cambiar de finca descarta el dataset entero y vuelve a bootstrapear. Con capturas sin subir
   * eso es perder el trabajo del día: no se pueden enviar desde la otra finca.
   */
  it('con trabajo en cola no se cambia de finca', async () => {
    const d = await decidirCambioDeFinca({
      organizaciones: fincas,
      fincaActual: 'f1',
      destino: 'f2',
      contarPendientes: contador(12),
    });
    expect(d.accion).toBe('bloquear');
    expect(d.accion === 'bloquear' && d.mensaje).toContain('12 cambios sin sincronizar');
    expect(d.accion === 'bloquear' && d.mensaje).toContain('no se pueden subir desde otra');
  });

  it('sin pendientes se descarta la base y se bootstrapea la finca nueva', async () => {
    expect(
      await decidirCambioDeFinca({
        organizaciones: fincas,
        fincaActual: 'f1',
        destino: 'f2',
        contarPendientes: contador(0),
      }),
    ).toEqual({ accion: 'descartar' });
  });

  it('sin ninguna finca en la lista no se puede cambiar a ningún lado', async () => {
    const d = await decidirCambioDeFinca({
      organizaciones: [],
      fincaActual: undefined,
      destino: 'f1',
      contarPendientes: contador(0),
    });
    expect(d.accion).toBe('bloquear');
  });

  it('entrar por primera vez a una finca válida, sin finca actual, descarta y bootstrapea', async () => {
    expect(
      await decidirCambioDeFinca({
        organizaciones: fincas,
        fincaActual: undefined,
        destino: 'f2',
        contarPendientes: contador(0),
      }),
    ).toEqual({ accion: 'descartar' });
  });
});
