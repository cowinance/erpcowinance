import { describe, expect, it } from 'vitest';
import { DEV_API_URL, apiErrorTitle, resolveDirectApiUrl } from './api';

/**
 * El motivo de error que ve el usuario.
 *
 * Existe este test porque el bug era invisible: la API respondía `{code, title}` con el motivo
 * exacto —«el peso está fuera de rango», «type inválido (customer|supplier|both)»— y once pantallas
 * leían `body.message.title`, que en esos cuerpos NO existe. Nunca fallaba nada: simplemente
 * mostraban «Error». Verificado contra la API corriendo antes de arreglarlo.
 */
describe('motivo de error de la API', () => {
  it('usa el `title` del cuerpo de dominio, que es lo que manda la API', () => {
    const cuerpo = { code: 'commerce.invalid_type', title: 'type inválido (customer|supplier|both)' };
    expect(apiErrorTitle(cuerpo, 'Error')).toBe('type inválido (customer|supplier|both)');
  });

  it('NO se queda con el genérico cuando hay motivo', () => {
    // Éste es el caso que estaba roto: en la manga el operario veía «ERROR AL GUARDAR» con guantes
    // y apuro, sin saber qué corregir.
    expect(apiErrorTitle({ code: 'x', title: 'El animal tiene retiro activo' }, 'ERROR AL GUARDAR')).toBe(
      'El animal tiene retiro activo',
    );
  });

  it('cae al genérico solo cuando de verdad no hay motivo', () => {
    expect(apiErrorTitle(null, 'Error')).toBe('Error');
    expect(apiErrorTitle(undefined, 'Error')).toBe('Error');
    expect(apiErrorTitle({}, 'Error')).toBe('Error');
    expect(apiErrorTitle({ code: 'sin_titulo' }, 'Error')).toBe('Error');
    expect(apiErrorTitle({ title: '' }, 'Error')).toBe('Error'); // vacío no es un motivo
  });

  it('entiende también el formato de error genérico de Nest', () => {
    // Algunas rutas no pasan por el filtro de dominio; el helper tiene que servir para las dos.
    expect(apiErrorTitle({ message: 'Unauthorized' }, 'Error')).toBe('Unauthorized');
    expect(apiErrorTitle({ message: { title: 'Token vencido' } }, 'Error')).toBe('Token vencido');
  });

  it('el cuerpo de dominio gana sobre el de Nest si vinieran los dos', () => {
    expect(apiErrorTitle({ title: 'lo específico', message: { title: 'lo genérico' } }, 'Error')).toBe('lo específico');
  });

  it('no explota con cuerpos raros', () => {
    // `res.json()` puede devolver cualquier cosa, incluido un string o un array.
    expect(apiErrorTitle('texto suelto', 'Error')).toBe('Error');
    expect(apiErrorTitle([1, 2, 3], 'Error')).toBe('Error');
    expect(apiErrorTitle(42, 'Error')).toBe('Error');
  });
});

/**
 * Precedencia de la URL interna de la API.
 *
 * El bug que cubre ya ocurrió dos veces: `NEXT_PUBLIC_API_URL` se INLINEA en el build, así que
 * reconstruir sin pasarla dejó la web apuntando a `localhost` y rompió el registro en producción.
 * `API_INTERNAL_URL` se lee en runtime; este test fija cuál gana y que el respaldo siga vivo para
 * los despliegues que todavía hornean la vieja.
 */
describe('URL interna de la API', () => {
  it('la interna (runtime) le gana a la pública (horneada en el build)', () => {
    expect(resolveDirectApiUrl('http://127.0.0.1:3001/v1', 'https://app.cowinance.com/v1')).toBe(
      'http://127.0.0.1:3001/v1',
    );
  });

  it('sin la interna cae a la pública: no rompe los despliegues que ya la pasan', () => {
    expect(resolveDirectApiUrl(undefined, 'https://app.cowinance.com/v1')).toBe('https://app.cowinance.com/v1');
  });

  it('sin ninguna, el default de desarrollo', () => {
    expect(resolveDirectApiUrl(undefined, undefined)).toBe(DEV_API_URL);
  });

  // Una variable declarada vacía en el .env (`API_INTERNAL_URL=`) llega como cadena vacía, no como
  // undefined. Si contara como valor, la web intentaría hablar con `` y fallaría sin decir por qué.
  it('una variable vacía o con espacios NO cuenta como configurada', () => {
    expect(resolveDirectApiUrl('', 'https://app.cowinance.com/v1')).toBe('https://app.cowinance.com/v1');
    expect(resolveDirectApiUrl('   ', 'https://app.cowinance.com/v1')).toBe('https://app.cowinance.com/v1');
    expect(resolveDirectApiUrl('', '')).toBe(DEV_API_URL);
  });

  it('recorta los espacios accidentales alrededor del valor', () => {
    expect(resolveDirectApiUrl('  http://127.0.0.1:3001/v1  ')).toBe('http://127.0.0.1:3001/v1');
  });
});
