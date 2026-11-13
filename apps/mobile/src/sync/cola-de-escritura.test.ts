import { describe, it, expect, vi } from 'vitest';
import { crearColaDeEscritura } from './cola-de-escritura';

/**
 * O-4 de la auditoría del ciclo sin señal (12-11-2026): una escritura local que falla ya no puede
 * desaparecer sin dejar rastro.
 */
describe('cola de escritura local', () => {
  it('serializa las escrituras en el orden en que se encolaron', async () => {
    const cola = crearColaDeEscritura();
    const orden: number[] = [];
    cola.encolar(async () => {
      await new Promise((r) => setTimeout(r, 15));
      orden.push(1);
    });
    cola.encolar(async () => {
      orden.push(2);
    });
    await cola.vaciar();
    expect(orden).toEqual([1, 2]);
  });

  it('cuenta la escritura que falla y avisa con el motivo', async () => {
    const cola = crearColaDeEscritura();
    const avisos: { fallos: number; detalle: string }[] = [];
    cola.alFallar((fallos, detalle) => avisos.push({ fallos, detalle }));

    cola.encolar(async () => {
      throw new Error('database or disk is full');
    });
    await cola.vaciar();

    expect(cola.fallos).toBe(1);
    expect(avisos).toEqual([{ fallos: 1, detalle: 'database or disk is full' }]);
  });

  it('un fallo no corta la cadena: lo que sigue se escribe igual', async () => {
    const cola = crearColaDeEscritura();
    const escrito: string[] = [];

    cola.encolar(async () => {
      throw new Error('disk I/O error');
    });
    cola.encolar(async () => {
      escrito.push('la pesada siguiente');
    });
    await cola.vaciar();

    // Abandonar la cadena dejaría de persistir TODO lo posterior: peor que el fallo puntual.
    expect(escrito).toEqual(['la pesada siguiente']);
    expect(cola.fallos).toBe(1);
  });

  it('acumula los fallos y el aviso siempre trae el total', async () => {
    const cola = crearColaDeEscritura();
    const totales: number[] = [];
    cola.alFallar((fallos) => totales.push(fallos));

    for (let i = 0; i < 3; i++) cola.encolar(async () => Promise.reject(new Error('sin espacio')));
    await cola.vaciar();

    expect(cola.fallos).toBe(3);
    expect(totales).toEqual([1, 2, 3]);
  });

  it('vaciar() nunca rechaza, aunque todo haya fallado', async () => {
    const cola = crearColaDeEscritura();
    cola.encolar(async () => {
      throw new Error('qué desastre');
    });
    await expect(cola.vaciar()).resolves.toBeUndefined();
  });

  it('la baja de la suscripción corta los avisos y no toca el contador', async () => {
    const cola = crearColaDeEscritura();
    const aviso = vi.fn();
    const baja = cola.alFallar(aviso);

    cola.encolar(async () => Promise.reject(new Error('uno')));
    await cola.vaciar();
    baja();
    cola.encolar(async () => Promise.reject(new Error('dos')));
    await cola.vaciar();

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(cola.fallos).toBe(2); // el contador es del almacenamiento, no de quien escucha
  });

  it('un error que no es Error también deja detalle legible', async () => {
    const cola = crearColaDeEscritura();
    const avisos: string[] = [];
    cola.alFallar((_, detalle) => avisos.push(detalle));
    cola.encolar(async () => Promise.reject('QuotaExceededError'));
    await cola.vaciar();
    expect(avisos).toEqual(['QuotaExceededError']);
  });

  /**
   * Sin saber QUÉ se estaba escribiendo, el motivo de SQLite llega sin contexto: no se distingue
   * una captura del día perdida de un contador de posición que se reescribe en el sync siguiente.
   */
  it('el aviso dice qué se estaba escribiendo', async () => {
    const cola = crearColaDeEscritura();
    const avisos: string[] = [];
    cola.alFallar((_, detalle) => avisos.push(detalle));

    cola.encolar(async () => Promise.reject(new Error('disk I/O error')), 'row:animals');
    cola.encolar(async () => Promise.reject(new Error('disk I/O error')), 'cursor');
    await cola.vaciar();

    expect(avisos).toEqual(['row:animals: disk I/O error', 'cursor: disk I/O error']);
  });

  it('sin etiqueta, el aviso es el motivo pelado', async () => {
    const cola = crearColaDeEscritura();
    const avisos: string[] = [];
    cola.alFallar((_, detalle) => avisos.push(detalle));
    cola.encolar(async () => Promise.reject(new Error('sin espacio')));
    await cola.vaciar();
    expect(avisos).toEqual(['sin espacio']);
  });

  it('reiniciar() vuelve a cero tras borrar el almacenamiento', async () => {
    const cola = crearColaDeEscritura();
    cola.encolar(async () => Promise.reject(new Error('sin espacio')));
    await cola.vaciar();
    expect(cola.fallos).toBe(1);
    cola.reiniciar();
    expect(cola.fallos).toBe(0);
  });
});
