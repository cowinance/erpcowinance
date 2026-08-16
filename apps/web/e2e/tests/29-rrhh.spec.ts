import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de RRHH (H-3): con cuentas/período/mapa sembrados por API, crear un empleado y una
 * liquidación desde la UI, aprobarla (devengado) y pagarla (caja), viéndola quedar Pagada.
 */
test('rrhh: crear empleado, liquidar, aprobar y pagar', async ({ page }) => {
  const u = uniqueUser('rrhh');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  /**
   * Las cuentas y el mapa rol→cuenta ya no se arman acá: desde `45cdb17` la finca nueva nace con
   * el plan sembrado, y trae los tres roles que la nómina necesita —`salary_expense`,
   * `salaries_payable`, `payroll_withholdings`— más `cash`. Tres de las cuatro cuentas que este
   * bloque creaba chocaban contra códigos ya existentes, el mapa quedaba con `undefined`, y
   * aprobar fallaba en `requireRoles` sin decir por qué en la UI.
   *
   * El PERÍODO sí se sigue creando, y no es simetría floja: la liquidación es de 2030 y aprobar
   * asienta el devengado con ESA fecha. Los períodos sembrados son del ejercicio en curso, así que
   * sin este el asiento no tiene dónde caer.
   */
  await post('/finance/periods', { name: 'Amplio', start_date: '2020-01-01', end_date: '2035-12-31' });

  // Empleado.
  await page.goto('/rrhh');
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible();
  await page.getByLabel('Nombre del empleado').fill('Juan Pérez');
  await page.getByRole('button', { name: 'Agregar empleado' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Juan Pérez' })).toBeVisible();

  // Liquidación.
  await page.goto('/rrhh/liquidaciones');
  await page.getByLabel('Período').fill('2030-05-01');
  await page.getByLabel('Empleado línea 1').selectOption({ label: 'Juan Pérez' });
  await page.getByLabel('Bruto línea 1').fill('1000');
  await page.getByLabel('Deducciones línea 1').fill('170');
  await page.getByRole('button', { name: 'Crear' }).click();

  const row = page.getByRole('listitem').filter({ hasText: '2030-05-01' });
  await expect(row.getByText('Borrador')).toBeVisible();
  await row.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '2030-05-01' }).getByText('Aprobada')).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: '2030-05-01' }).getByRole('button', { name: 'Pagar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '2030-05-01' }).getByText('Pagada')).toBeVisible();
});
