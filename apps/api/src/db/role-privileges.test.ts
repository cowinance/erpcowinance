import { describe, expect, it } from 'vitest';
import { assessRolePrivileges } from './role-privileges';

/**
 * La guardia que decide si la RLS existe de verdad en producción. Se prueba PURA —sin base— porque
 * el punto no es «¿PostgreSQL devuelve estas columnas?» sino «¿qué hacemos con cada combinación?»,
 * y esa decisión tiene que quedar clavada: aflojarla a un warning en producción sería volver al
 * estado en el que un despliegue mal configurado sirve sin aislamiento y nadie se entera.
 */
describe('privilegios del rol de servicio', () => {
  const rol = (over: Partial<{ rolsuper: boolean; rolbypassrls: boolean }> = {}) => ({
    rolname: 'cowinance_app',
    rolsuper: false,
    rolbypassrls: false,
    ...over,
  });

  it('rol restringido: OK, y lo dice sin ambigüedad', () => {
    const v = assessRolePrivileges(rol(), { production: true });
    expect(v.level).toBe('ok');
    expect(v.message).toContain('cowinance_app');
    expect(v.message).toContain('la RLS se le aplica');
  });

  it('SUPERUSER en producción: fatal', () => {
    const v = assessRolePrivileges(rol({ rolsuper: true }), { production: true });
    expect(v.level).toBe('fatal');
    expect(v.message).toContain('SUPERUSER');
  });

  it('BYPASSRLS en producción: fatal — es tan grave como SUPERUSER y se olvida más', () => {
    const v = assessRolePrivileges(rol({ rolbypassrls: true }), { production: true });
    expect(v.level).toBe('fatal');
    expect(v.message).toContain('BYPASSRLS');
    expect(v.message).not.toContain('SUPERUSER y');
  });

  it('los dos a la vez: los nombra a los dos, no solo el primero', () => {
    const v = assessRolePrivileges(rol({ rolsuper: true, rolbypassrls: true }), { production: true });
    expect(v.level).toBe('fatal');
    expect(v.message).toContain('SUPERUSER y BYPASSRLS');
  });

  it('fuera de producción avisa pero no aborta: PGlite es superusuario a propósito', () => {
    const v = assessRolePrivileges(rol({ rolsuper: true }), { production: false });
    expect(v.level).toBe('warn');
    expect(v.message).toContain('ninguna prueba que corras contra esta base está ejerciendo la RLS');
  });

  it('el mensaje trae el ALTER ROLE listo para copiar, con el nombre real del rol', () => {
    const v = assessRolePrivileges(
      { rolname: 'mi_rol_raro', rolsuper: false, rolbypassrls: true },
      { production: true },
    );
    expect(v.message).toContain('ALTER ROLE mi_rol_raro NOSUPERUSER NOBYPASSRLS;');
    // Y distingue los dos roles: confundirlos es el falso positivo que enseñaría a ignorar la guardia.
    expect(v.message).toContain('DATABASE_ADMIN_URL sí necesita');
  });
});
