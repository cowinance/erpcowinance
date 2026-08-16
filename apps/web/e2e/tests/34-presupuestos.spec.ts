import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Presupuestos (BG-3): con cuentas/período/asiento real sembrados por API, crear un
 * presupuesto y cargar sus líneas desde /finanzas/presupuestos, y ver el comparativo contra el real.
 */
test('presupuestos: cargar líneas y ver el comparativo vs real', async ({ page }) => {
  const u = uniqueUser('presu');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  // Período 2030 + un gasto REAL de 1200 para comparar contra el presupuesto.
  //
  // La cuenta de caja NO se crea: `1.1.01` ya viene en el plan sembrado (`45cdb17`) y el INSERT
  // devolvía 409, dejando `caja.id` en `undefined` y el asiento sin contrapartida. Se busca por
  // CÓDIGO y no por nombre porque el código es el contrato del plan; el nombre es una etiqueta que
  // cada finca puede editar.
  const gastos = await post('/finance/accounts', { code: '5.1.10', name: 'Alimentación', type: 'expense' });
  const cuentas: any[] = await (await page.request.get(`${API_URL}/finance/accounts`, { headers: auth })).json();
  const caja = cuentas.find((c) => c.code === '1.1.01')!;
  expect(caja, 'el plan de cuentas sembrado tiene que traer 1.1.01').toBeTruthy();
  await post('/finance/periods', { name: '2030', start_date: '2030-01-01', end_date: '2030-12-31' });
  await post('/finance/journal', { entry_date: '2030-01-15', lines: [{ account_id: gastos.id, debit: 1200 }, { account_id: caja.id, credit: 1200 }] });

  await page.goto('/finanzas/presupuestos');
  await expect(page.getByRole('heading', { name: 'Finanzas' })).toBeVisible();

  // Crear el presupuesto 2030 y seleccionarlo.
  await page.getByLabel('Nombre del presupuesto').fill('Presupuesto 2030');
  await page.getByLabel('Año fiscal').fill('2030');
  await page.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('button', { name: /Presupuesto 2030/ }).click();

  // Cargar una línea: gasto de 1000 en enero.
  await page.getByRole('button', { name: '+ Línea' }).click();
  await page.getByLabel('Cuenta línea 1').selectOption({ label: '5.1.10 · Alimentación' });
  await page.getByLabel('Mes línea 1').selectOption('1');
  await page.getByLabel('Monto línea 1').fill('1000');
  await page.getByRole('button', { name: 'Guardar líneas' }).click();

  // Comparativo: presupuesto 1000, real 1200 → desvío +200 (sobregiro, 20%).
  const row = page.getByRole('row').filter({ hasText: 'Alimentación' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('1000');
  await expect(row).toContainText('1200');
  await expect(row).toContainText('200');
  await expect(row).toContainText('20%');
});
