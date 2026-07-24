import { describe, it, expect } from 'vitest';
import { resolveJwtSecret, DEV_JWT_SECRET } from './jwt-secret';

const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;
const dev = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'development', ...extra }) as NodeJS.ProcessEnv;

describe('resolveJwtSecret', () => {
  it('en desarrollo usa el fallback: `npm run api` arranca sin configurar nada', () => {
    expect(resolveJwtSecret(dev())).toBe(DEV_JWT_SECRET);
    expect(resolveJwtSecret({} as NodeJS.ProcessEnv)).toBe(DEV_JWT_SECRET);
  });

  it('en desarrollo respeta la clave explícita si está', () => {
    expect(resolveJwtSecret(dev({ JWT_SECRET: 'la-mia' }))).toBe('la-mia');
  });

  // El corazón del fix: en producción NO hay default silencioso.
  it('en producción falla si falta JWT_SECRET', () => {
    expect(() => resolveJwtSecret(prod())).toThrow(/JWT_SECRET es obligatorio/);
  });

  it('en producción falla si la clave es la de desarrollo (es pública)', () => {
    expect(() => resolveJwtSecret(prod({ JWT_SECRET: DEV_JWT_SECRET }))).toThrow(/clave de desarrollo/);
  });

  it('en producción falla si la clave es demasiado corta', () => {
    expect(() => resolveJwtSecret(prod({ JWT_SECRET: 'corta' }))).toThrow(/demasiado corta/);
  });

  it('en producción acepta una clave fuerte', () => {
    const fuerte = 'K'.repeat(48);
    expect(resolveJwtSecret(prod({ JWT_SECRET: fuerte }))).toBe(fuerte);
  });

  it('ignora el espacio en blanco alrededor (un .env mal copiado no debe pasar por clave)', () => {
    expect(() => resolveJwtSecret(prod({ JWT_SECRET: '   ' }))).toThrow(/JWT_SECRET es obligatorio/);
    expect(resolveJwtSecret(dev({ JWT_SECRET: '  la-mia  ' }))).toBe('la-mia');
  });
});
