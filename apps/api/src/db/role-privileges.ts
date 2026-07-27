/**
 * Privilegios del rol de SERVICIO — la comprobación que decide si la RLS existe de verdad.
 *
 * ## Por qué esto merece una guardia propia
 *
 * Todo el aislamiento del sistema —las policies `tenant_isolation` sobre 140 tablas, y ahora la
 * `platform_read` del panel— descansa sobre UNA premisa: que el rol con el que la app sirve las
 * requests NO es superusuario y NO tiene `BYPASSRLS`. PostgreSQL le saltea la RLS a esos roles
 * ENTERA, policies incluidas. No hay error, no hay log, no hay síntoma: las consultas simplemente
 * devuelven las filas de todos los tenants.
 *
 * Y es una premisa que hoy no se verifica en ningún lado:
 *
 *  · `verify:rls` la prueba, pero contra un rol que **el propio script crea** (`rls_probe`, con
 *    NOSUPERUSER NOBYPASSRLS explícito). Demuestra que las policies son correctas; no dice nada
 *    sobre con qué rol corre producción.
 *  · Los tests corren sobre PGlite, que conecta como SUPERUSUARIO. Ahí la RLS nunca se ejerce.
 *
 * O sea: el conjunto de pruebas puede estar entero en verde mientras producción sirve sin
 * aislamiento. Esa brecha es la que cierra este archivo, y es el paso 2.2 pendiente de la auditoría
 * («ejercitar la RLS en el pipeline de despliegue, no solo en CI»).
 *
 * ## Por qué aborta el arranque en producción
 *
 * Misma decisión que `JWT_SECRET` (ver `modules/auth/jwt-secret.ts`) y por el mismo razonamiento:
 * un arranque que falla es un incidente de cinco minutos con un mensaje que dice qué hacer; un
 * arranque silencioso con las fincas viéndose entre sí es una fuga que nadie detecta hasta que un
 * cliente ve datos de otro. Fuera de producción solo avisa: en dev el superusuario de PGlite es el
 * comportamiento buscado, no un error.
 *
 * ## Qué NO comprueba
 *
 * El rol ADMIN (`DATABASE_ADMIN_URL`), que corre el DDL y las migraciones, **tiene que** ser
 * privilegiado: crear tablas y policies lo exige. La comprobación va sobre la conexión de servicio
 * (`driver.query` → pool de `DATABASE_URL`), que es la que atiende las requests. Confundir las dos
 * daría un falso positivo que enseñaría a ignorar la guardia.
 */

/** Lo que devuelve `pg_roles` para el rol con el que estamos conectados. */
export interface RolePrivileges {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

export type RolePrivilegeLevel = 'ok' | 'warn' | 'fatal';

export interface RolePrivilegeVerdict {
  level: RolePrivilegeLevel;
  message: string;
}

/**
 * Decide qué hacer con los privilegios observados. PURA: sin base, sin env, sin logger — así se
 * prueban los cuatro casos sin levantar un PostgreSQL.
 */
export function assessRolePrivileges(
  priv: RolePrivileges,
  opts: { production: boolean },
): RolePrivilegeVerdict {
  const problemas: string[] = [];
  if (priv.rolsuper) problemas.push('SUPERUSER');
  if (priv.rolbypassrls) problemas.push('BYPASSRLS');

  if (problemas.length === 0)
    return {
      level: 'ok',
      message: `rol de servicio «${priv.rolname}»: sin SUPERUSER ni BYPASSRLS (la RLS se le aplica)`,
    };

  const detalle =
    `El rol de servicio «${priv.rolname}» tiene ${problemas.join(' y ')}. PostgreSQL le SALTEA la ` +
    'row-level security por completo, así que las policies de aislamiento por tenant no se aplican: ' +
    'cualquier consulta puede devolver filas de cualquier finca. Corregilo con:\n' +
    `      ALTER ROLE ${priv.rolname} NOSUPERUSER NOBYPASSRLS;\n` +
    '  y serví con un rol distinto del que corre las migraciones (DATABASE_ADMIN_URL sí necesita ' +
    'privilegios; DATABASE_URL no).';

  if (opts.production) return { level: 'fatal', message: detalle };

  return {
    level: 'warn',
    message:
      `${detalle}\n  Fuera de producción esto NO aborta el arranque, pero significa que ninguna ` +
      'prueba que corras contra esta base está ejerciendo la RLS.',
  };
}

/** SQL de la comprobación. Constante para que el script de verificación use exactamente la misma. */
export const ROLE_PRIVILEGES_SQL = `
  SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
   WHERE rolname = current_user`;
