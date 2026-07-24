import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from './rate-limit';

const RULE = { limit: 3, windowMs: 60_000 };

describe('SlidingWindowRateLimiter', () => {
  it('permite hasta el límite y rechaza el siguiente', () => {
    const rl = new SlidingWindowRateLimiter();
    expect(rl.hit('ip', RULE, 0).allowed).toBe(true);
    expect(rl.hit('ip', RULE, 1).allowed).toBe(true);
    expect(rl.hit('ip', RULE, 2).allowed).toBe(true);
    expect(rl.hit('ip', RULE, 3).allowed).toBe(false);
  });

  it('informa cuántos segundos faltan para el próximo intento', () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit('ip', RULE, 0);
    expect(rl.hit('ip', RULE, 10_000).retryAfterSeconds).toBe(50);
  });

  it('la ventana desliza: al vencer los intentos viejos vuelve a permitir', () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit('ip', RULE, 0);
    expect(rl.hit('ip', RULE, 59_999).allowed).toBe(false);
    expect(rl.hit('ip', RULE, 60_001).allowed).toBe(true);
  });

  // Si el intento rechazado contara, martillar extendería el bloqueo para siempre y el usuario
  // legítimo detrás de la misma IP nunca volvería a entrar.
  it('el intento rechazado NO extiende el bloqueo', () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit('ip', RULE, 0);
    for (let t = 1000; t < 59_000; t += 1000) rl.hit('ip', RULE, t);
    expect(rl.hit('ip', RULE, 60_001).allowed).toBe(true);
  });

  it('las claves son independientes entre sí', () => {
    const rl = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) rl.hit('a', RULE, 0);
    expect(rl.hit('a', RULE, 0).allowed).toBe(false);
    expect(rl.hit('b', RULE, 0).allowed).toBe(true);
  });

  it('prune libera las claves ya vencidas', () => {
    const rl = new SlidingWindowRateLimiter();
    rl.hit('a', RULE, 0);
    rl.hit('b', RULE, 100_000);
    rl.prune(120_000, RULE.windowMs);
    expect(rl.size).toBe(1);
  });
});
