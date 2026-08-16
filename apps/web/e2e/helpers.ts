import fs from 'fs';
import { expect, type Page } from '@playwright/test';
import { LOG_FILE, PASSWORD } from './env';

export interface TestUser {
  email: string;
  fullName: string;
  org: string;
  farm: string;
  password: string;
}

/**
 * La celda de saldo en la tabla de EXISTENCIAS de `/inventario`.
 *
 * Existe porque `/inventario` tiene dos tablas que muestran el mismo ítem con su cantidad —
 * existencias y rotación— así que buscar «50 kg» como texto suelto encuentra las dos y Playwright
 * corta por ambigüedad. Media docena de specs de otros módulos (compras, ventas, nutrición,
 * agricultura, maquinaria) terminan comprobando stock acá, y todos se rompieron a la vez el día
 * que apareció la segunda tabla.
 *
 * Va como helper y no copiado en cada spec para que la próxima tabla que se agregue a esa pantalla
 * se arregle en un solo lugar.
 */
export function stockCell(page: Page, saldo: string) {
  return page.getByRole('table', { name: 'Existencias' }).getByRole('cell', { name: saldo });
}

let seq = 0;
/** Usuario único por invocación: emails/nombres irrepetibles (sin depender de demo). */
export function uniqueUser(prefix = 'u'): TestUser {
  seq += 1;
  const id = `${Date.now().toString(36)}${seq}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    email: `e2e-${prefix}-${id}@example.test`,
    fullName: `E2E ${prefix} ${id}`,
    org: `Org ${id}`,
    farm: `Finca ${id}`,
    password: PASSWORD,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bytes actuales del log — para acotar la búsqueda de emails a lo posterior al escenario. */
export function logSize(): number {
  try {
    return fs.statSync(LOG_FILE).size;
  } catch {
    return 0;
  }
}

/**
 * Localiza el token de acción en el log del API, filtrando por destinatario y
 * propósito (link `/verify-email` o `/reset-password`) y por posición posterior a
 * `sinceOffset`. Toma el más reciente que matchee. El token queda SOLO en memoria:
 * nunca se imprime ni se incluye en el mensaje de error.
 */
export async function waitForActionToken(
  recipient: string,
  purpose: 'verify' | 'reset',
  sinceOffset = 0,
  timeoutMs = 15_000,
): Promise<string> {
  const linkPath = purpose === 'verify' ? 'verify-email' : 'reset-password';
  const re = new RegExp(`EMAIL → ${escapeRe(recipient)} ·[\\s\\S]*?${linkPath}\\?token=([A-Za-z0-9_-]+)`, 'g');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let content = '';
    try {
      content = fs.readFileSync(LOG_FILE).subarray(sinceOffset).toString('utf8');
    } catch {
      /* el log puede no existir aún */
    }
    let m: RegExpExecArray | null;
    let last: string | null = null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) last = m[1];
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`No apareció el email de ${purpose} para el destinatario esperado dentro del timeout`);
}

/** Completa el formulario de /register (espera a que el select de países cargue). */
export async function fillRegister(page: Page, u: TestUser, country = 'Argentina'): Promise<void> {
  await page.goto('/register');
  const countrySelect = page.getByLabel('País');
  await expect(countrySelect).toBeVisible(); // catálogo real cargado
  await page.getByLabel('Nombre completo').fill(u.fullName);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByLabel('Organización').fill(u.org);
  await page.getByLabel('Finca').fill(u.farm);
  await countrySelect.selectOption({ label: country }); // permite escoger un país conocido
}

/** Registro + auto-login → dashboard (`window.location.href = '/'`). */
export async function registerAndAutoLogin(page: Page, u: TestUser, country = 'Argentina'): Promise<void> {
  await fillRegister(page, u, country);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

/** Login por la pantalla real (no persiste credenciales en disco). */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}
