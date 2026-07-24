import { describe, it, expect } from 'vitest';
import { scryptSync } from 'crypto';
import { hashPassword, verifyPassword, needsRehash } from './passwords';

/** Hash con el esquema histórico `s2` (defaults de Node), tal como quedó en bases ya creadas. */
function legacyS2(password: string, salt = 'a'.repeat(32)): string {
  return `s2:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

describe('passwords', () => {
  it('emite el esquema actual y verifica la contraseña correcta', async () => {
    const stored = await hashPassword('correcta-1234');
    expect(stored.startsWith('s3:')).toBe(true);
    expect(await verifyPassword('correcta-1234', stored)).toBe(true);
  });

  it('rechaza la contraseña incorrecta', async () => {
    const stored = await hashPassword('correcta-1234');
    expect(await verifyPassword('incorrecta', stored)).toBe(false);
  });

  it('el salt es aleatorio: dos hashes de la misma contraseña difieren', async () => {
    expect(await hashPassword('misma')).not.toBe(await hashPassword('misma'));
  });

  // Lo que hace que subir el costo sea seguro: las contraseñas ya guardadas siguen entrando.
  it('sigue verificando los hashes históricos s2', async () => {
    const stored = legacyS2('vieja-pero-valida');
    expect(await verifyPassword('vieja-pero-valida', stored)).toBe(true);
    expect(await verifyPassword('otra', stored)).toBe(false);
  });

  it('marca para re-hash solo lo que quedó con parámetros viejos', async () => {
    expect(needsRehash(legacyS2('x'))).toBe(true);
    expect(needsRehash(await hashPassword('x'))).toBe(false);
    expect(needsRehash(null)).toBe(false);
  });

  it('trata como inválido —sin lanzar— todo hash mal formado', async () => {
    for (const malo of [null, undefined, '', 'sin-separadores', 's9:salt:hash', 's3:solo-salt']) {
      expect(await verifyPassword('x', malo as string | null | undefined)).toBe(false);
    }
  });

  // `timingSafeEqual` lanza si los buffers difieren en longitud: un hash truncado en la base
  // tiene que dar "credenciales inválidas", no un 500.
  it('no lanza con un hash truncado', async () => {
    const truncado = (await hashPassword('x')).slice(0, -20);
    expect(await verifyPassword('x', truncado)).toBe(false);
  });
});
