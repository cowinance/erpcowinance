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

  const mk = async (code: string, name: string, type: string) => (await post('/finance/accounts', { code, name, type })).id;
  const roles = {
    salary_expense: await mk('6.1.01', 'Sueldos', 'expense'),
    salaries_payable: await mk('2.1.03', 'Remuneraciones a pagar', 'liability'),
    payroll_withholdings: await mk('2.1.04', 'Retenciones a pagar', 'liability'),
    cash: await mk('1.1.01', 'Caja', 'asset'),
  };
  await post('/finance/periods', { name: 'Amplio', start_date: '2020-01-01', end_date: '2035-12-31' });
  await page.request.put(`${API_URL}/finance/posting-accounts`, { headers: auth, data: roles });

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
