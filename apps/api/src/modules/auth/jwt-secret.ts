/**
 * Clave de firma de los JWT (access, refresh y tokens de archivo).
 *
 * El fallback de desarrollo es una comodidad deliberada: `npm run api` tiene que arrancar sin
 * configurar nada. Pero ese mismo fallback en producción es la falla más grave posible del
 * sistema — la clave es pública (está en el repo), y con ella cualquiera firma un access token
 * con el `ten` (tenant) y el `role` que quiera: acceso total a los datos de cualquier finca,
 * sin tocar la base ni la contraseña de nadie. La RLS no protege de esto: el token ES la
 * identidad que la RLS respeta.
 *
 * Por eso en producción no hay default: si falta `JWT_SECRET`, el proceso NO arranca. Un boot
 * que falla es un incidente de 5 minutos; un boot silencioso con clave conocida es una fuga
 * que no se detecta.
 */
export const DEV_JWT_SECRET = 'cowinance-dev-secret';

/** Mínimo razonable para una clave HMAC (256 bits en hex/base64 ≈ 32+ caracteres). */
export const MIN_SECRET_LENGTH = 32;

export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();
  const isProduction = env.NODE_ENV === 'production';

  if (!secret) {
    if (isProduction)
      throw new Error(
        'JWT_SECRET es obligatorio en producción. Sin él la API firmaría los tokens con la clave ' +
          'de desarrollo, que es pública: cualquiera podría emitir un token válido para cualquier ' +
          'tenant. Generá una: `openssl rand -base64 48`.',
      );
    return DEV_JWT_SECRET;
  }

  if (isProduction && secret === DEV_JWT_SECRET)
    throw new Error('JWT_SECRET no puede ser la clave de desarrollo en producción (es pública).');

  if (isProduction && secret.length < MIN_SECRET_LENGTH)
    throw new Error(
      `JWT_SECRET es demasiado corta (${secret.length} caracteres; mínimo ${MIN_SECRET_LENGTH}). ` +
        'Generá una: `openssl rand -base64 48`.',
    );

  return secret;
}
