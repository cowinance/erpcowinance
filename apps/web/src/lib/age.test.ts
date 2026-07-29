import { describe, expect, it } from 'vitest';
import { describeAge, minutesSince, STALE_MINUTES } from './age';

const T0 = Date.parse('2026-07-28T15:00:00Z');

describe('cuánto hace que se armó la pantalla', () => {
  it('un reloj del dispositivo ATRASADO no da minutos negativos', () => {
    // El caso real: un teléfono de campo que perdió la hora. La diferencia contra el servidor da
    // negativa y el cartel diría «actualizado hace -3 minutos». Un cartel que se contradice deja de
    // servir, y existe justamente para que el productor le crea.
    expect(minutesSince('2026-07-28T15:03:00Z', T0)).toBe(0);
    expect(describeAge(minutesSince('2026-07-28T15:03:00Z', T0))).toBe('Actualizado recién');
  });

  it('una fecha ilegible no rompe la pantalla', () => {
    expect(minutesSince('cualquier cosa', T0)).toBe(0);
  });

  it('trunca hacia abajo: nunca dice que es más nuevo de lo que es', () => {
    // 59 segundos son «recién», no «hace 1 min». El redondeo tiene que ir siempre para el lado de
    // mostrar MÁS antigüedad, no menos: el error caro es que el dato parezca más fresco.
    expect(minutesSince('2026-07-28T14:59:01Z', T0)).toBe(0);
    expect(minutesSince('2026-07-28T14:58:59Z', T0)).toBe(1);
  });

  it('pasa a horas cuando los minutos dejan de leerse', () => {
    expect(describeAge(59)).toBe('Actualizado hace 59 min');
    expect(describeAge(60)).toBe('Actualizado hace 1 h');
    expect(describeAge(143)).toBe('Actualizado hace 2 h');
  });

  it('el umbral de «esto ya está viejo» es explícito', () => {
    // Que sea una constante y no un 5 suelto en el JSX: es una decisión de producto —a partir de
    // cuándo el riesgo deja de ser molestar y pasa a ser creerle a un número viejo— y se discute.
    expect(STALE_MINUTES).toBe(5);
  });
});
