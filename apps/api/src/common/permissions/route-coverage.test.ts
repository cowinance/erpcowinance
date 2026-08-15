import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CAPACIDADES_SIN_RUTA, ROUTE_RULES, reglasTapadas, ruleFor } from './capabilities';
import { MATRIX, ROLES, permite } from './matrix';

/**
 * El gate de la matriz de permisos: ninguna ruta puede quedar sin capacidad asignada.
 *
 * ## Por qué lee el CÓDIGO FUENTE y no la metadata de Nest
 *
 * Leer la metadata exigiría importar los 67 controladores, y con ellos media aplicación. Este test
 * tiene que poder correr en milisegundos y fallar por UNA razón sola. Parsear el fuente es además
 * lo que ya hacen los otros gates del repo (backticks en comentarios SQL, altos fijos en el móvil),
 * así que es el estilo de la casa.
 *
 * El riesgo del parseo —que una ruta declarada de forma rara no se detecte— se acota verificando
 * que el total encontrado no baje: si alguien escribe rutas de una manera que este test no ve, el
 * conteo cae y salta.
 */

const CONTROLADORES = 'apps/api/src/modules';

interface Ruta {
  archivo: string;
  metodo: string;
  path: string;
  publica: boolean;
}

function archivosControlador(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivosControlador(p, out);
    else if (n.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function rutasDeclaradas(): Ruta[] {
  const rutas: Ruta[] = [];
  for (const archivo of archivosControlador(CONTROLADORES)) {
    const src = readFileSync(archivo, 'utf8');
    const prefijo = /@Controller\(\s*'([^']*)'/.exec(src)?.[1] ?? '';
    // `@Public()` puede estar en la clase (todo el controlador) o justo antes de un handler.
    const claseEsPublica = /@Public\(\)[\s\S]{0,120}?@Controller|@Controller[\s\S]{0,120}?@Public\(\)/.test(src);
    const lineas = src.split('\n');
    let publicaSuelta = false;
    for (const linea of lineas) {
      if (/@Public\(\)/.test(linea) || /PlatformAdmin|@UseGuards/.test(linea)) publicaSuelta = true;
      const m = /@(Get|Post|Put|Patch|Delete)\(\s*'?([^')]*)'?\s*\)/.exec(linea);
      if (!m) continue;
      const path = [prefijo, m[2]].filter(Boolean).join('/');
      rutas.push({ archivo, metodo: m[1].toUpperCase(), path, publica: claseEsPublica || publicaSuelta });
      publicaSuelta = false;
    }
  }
  return rutas;
}

describe('matriz de permisos — cobertura de rutas', () => {
  const rutas = rutasDeclaradas();

  it('encuentra todas las rutas de la API (si baja, el parseo dejó de ver algo)', () => {
    expect(rutas.length).toBeGreaterThanOrEqual(480);
  });

  it('NINGUNA ruta autenticada queda sin capacidad asignada', () => {
    // El invariante que hace que este archivo exista. Sin él, la ruta 481 nace accesible para
    // cualquier rol y no hay forma de enterarse hasta que alguien ve lo que no debía.
    const huerfanas = rutas
      .filter((r) => !r.publica)
      .filter((r) => !ruleFor(r.path))
      .map((r) => `${r.metodo} /${r.path}   (${r.archivo.replace(/\\/g, '/').split('/modules/')[1]})`);

    expect(
      huerfanas,
      `Rutas sin capacidad. Agregá una regla en capabilities.ts:\n  ${huerfanas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('ninguna regla queda tapada por otra anterior más general', () => {
    // Si `health` estuviera antes que `health/costs`, la capacidad de valuación nunca se aplicaría
    // y el veterinario vería los costos. El orden de ROUTE_RULES es parte del contrato.
    expect(reglasTapadas()).toEqual([]);
  });

  it('toda regla declarada sirve para algo (no hay prefijos muertos)', () => {
    const muertas = ROUTE_RULES.filter((regla) => !rutas.some((r) => ruleFor(r.path) === regla)).map((r) => r.prefix);
    expect(muertas, `Reglas que no cubren ninguna ruta real: ${muertas.join(', ')}`).toEqual([]);
  });
});

describe('matriz de permisos — cableado', () => {
  const authModule = readFileSync('apps/api/src/modules/auth/auth.module.ts', 'utf8');

  it('el interceptor de permisos está registrado como global', () => {
    expect(authModule).toMatch(/APP_INTERCEPTOR,\s*useClass:\s*PermissionsInterceptor/);
  });

  it('corre DESPUÉS del de autenticación (si no, llega sin rol y no autoriza)', () => {
    // Invertir el orden no rompe nada visible: la app responde igual. Simplemente deja de
    // autorizar, porque `requestContext` todavía no tiene el rol. Por eso vale un test propio:
    // es la clase de error que ninguna prueba funcional detecta.
    const auth = authModule.indexOf('useClass: AuthInterceptor');
    const permisos = authModule.indexOf('useClass: PermissionsInterceptor');
    expect(auth, 'AuthInterceptor no está registrado').toBeGreaterThan(-1);
    expect(permisos, 'PermissionsInterceptor no está registrado').toBeGreaterThan(-1);
    expect(permisos, 'PermissionsInterceptor tiene que ir DESPUÉS de AuthInterceptor').toBeGreaterThan(auth);
  });
});

describe('matriz de permisos — invariantes de los roles', () => {
  it('el dueño alcanza TODA capacidad declarada', () => {
    // Una capacidad nueva que se olvide de darle al dueño lo dejaría afuera de su propia finca.
    // Se comprueba `read` y no `write` porque hay capacidades que son de lectura POR DISEÑO
    // (sesión, alertas): exigirles escritura haría fallar el test por la razón equivocada.
    const capacidades = new Set([...ROUTE_RULES.map((r) => r.cap), ...CAPACIDADES_SIN_RUTA]);
    const faltantes = [...capacidades].filter((cap) => !permite('owner', cap, 'read'));
    expect(faltantes, `Al owner le faltan: ${faltantes.join(', ')}`).toEqual([]);
  });

  it('solo el dueño toca la suscripción', () => {
    const otros = ROLES.filter((r) => r !== 'owner').filter((r) => permite(r, 'suscripcion', 'read'));
    expect(otros).toEqual([]);
  });

  it('nadie fuera de la administración ve plata', () => {
    // El corte más duro de la matriz: quien no la necesita, no la ve. Un veterinario que ve el
    // margen por animal es una fuga, no una comodidad.
    for (const rol of ['veterinarian', 'foreman', 'worker'] as const) {
      expect(permite(rol, 'comercial', 'read'), `${rol} no debería ver comercial`).toBe(false);
      expect(permite(rol, 'finanzas', 'read'), `${rol} no debería ver finanzas`).toBe(false);
      expect(permite(rol, 'impuestos', 'read'), `${rol} no debería ver impuestos`).toBe(false);
      expect(permite(rol, 'inventario.valuacion', 'read'), `${rol} no debería ver costos`).toBe(false);
      expect(permite(rol, 'rrhh.liquidacion', 'read'), `${rol} no debería ver sueldos`).toBe(false);
    }
  });

  it('el veterinario ve el stock pero no lo que cuesta', () => {
    expect(permite('veterinarian', 'inventario.existencias', 'read')).toBe(true);
    expect(permite('veterinarian', 'inventario.valuacion', 'read')).toBe(false);
  });

  it('el capataz aplica lo sanitario pero no lo indica', () => {
    expect(permite('foreman', 'sanidad.aplicar', 'write')).toBe(true);
    expect(permite('foreman', 'sanidad.indicar', 'read')).toBe(true);
    expect(permite('foreman', 'sanidad.indicar', 'write')).toBe(false);
  });

  it('el capataz carga el parte pero no liquida ni da altas', () => {
    expect(permite('foreman', 'rrhh.parte', 'write')).toBe(true);
    expect(permite('foreman', 'rrhh.liquidacion', 'read')).toBe(false);
    expect(permite('foreman', 'rrhh.legajo', 'read')).toBe(false);
  });

  it('el contador no entra a la ficha de un animal ni a lo clínico', () => {
    for (const cap of ['hato', 'pesajes', 'sanidad.indicar', 'sanidad.aplicar', 'reproduccion', 'genetica'] as const) {
      expect(permite('accountant', cap, 'read'), `el contador no debería ver ${cap}`).toBe(false);
    }
  });

  it('escribir implica leer, y un rol desconocido no puede nada', () => {
    expect(permite('foreman', 'hato', 'read')).toBe(true); // lo tiene como write
    expect(permite('intruso', 'sesion', 'read')).toBe(false);
    expect(permite('', 'hato', 'read')).toBe(false);
  });

  it('todos los roles conservan lo transversal (sesión, alertas, sync)', () => {
    for (const rol of ROLES) {
      expect(permite(rol, 'sesion', 'read'), `${rol} sin sesión`).toBe(true);
      expect(permite(rol, 'alertas', 'read'), `${rol} sin alertas`).toBe(true);
      expect(permite(rol, 'sincronizacion', 'write'), `${rol} sin sync`).toBe(true);
    }
  });

  it('la matriz no declara capacidades inventadas', () => {
    // Tolera las que están en CAPACIDADES_SIN_RUTA —decisiones tomadas cuyo módulo falta— pero
    // no un nombre mal escrito, que si no otorgaría un permiso que nunca se evalúa.
    const conocidas = new Set<string>([...ROUTE_RULES.map((r) => r.cap), ...CAPACIDADES_SIN_RUTA]);
    for (const rol of ROLES) {
      const inventadas = Object.keys(MATRIX[rol]).filter((cap) => !conocidas.has(cap));
      expect(inventadas, `${rol} declara capacidades inexistentes: ${inventadas.join(', ')}`).toEqual([]);
    }
  });
});
