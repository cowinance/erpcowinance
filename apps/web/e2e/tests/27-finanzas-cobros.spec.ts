import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Finanzas (F-4b): con mapa/período/venta sembrados por API, emitir factura + contabilizar
 * el documento y registrar el cobro imputado desde la UI, y ver la factura pagada (saldo 0).
 */
test('finanzas: emitir factura, contabilizar y cobrar', async ({ page }) => {
  const u = uniqueUser('fincob');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  // Plan de cuentas + período amplio + mapa de posteo.
  const mk = async (code: string, name: string, type: string) => (await post('/finance/accounts', { code, name, type })).id;
  const roles = {
    receivable: await mk('1.1.02', 'Deudores', 'asset'),
    sales_income: await mk('4.1.01', 'Ventas', 'income'),
    vat_debit: await mk('2.1.01', 'IVA débito', 'liability'),
    purchases: await mk('5.1.01', 'Compras', 'expense'),
    vat_credit: await mk('1.1.03', 'IVA crédito', 'asset'),
    payable: await mk('2.1.02', 'Proveedores', 'liability'),
    cash: await mk('1.1.01', 'Caja', 'asset'),
  };
  await post('/finance/periods', { name: 'Amplio', start_date: '2020-01-01', end_date: '2035-12-31' });
  await page.request.put(`${API_URL}/finance/posting-accounts`, { headers: auth, data: roles });

  // Cliente + ítem + una venta sin impuesto (total 100).
  const cust = await post('/commerce/partners', { type: 'customer', name: 'Cliente Cobro', customer_segment: 'retail' });
  const item = await post('/inventory/items', { name: 'Servicio', unit: 'un' });
  const sale = await post('/commerce/sales', { customer_partner_id: cust.id, type: 'product', document_number: 'V-001', lines: [{ item_id: item.id, quantity: 1, unit_price: 100 }] });

  // Facturas: contabilizar el documento y emitir la factura.
  await page.goto('/finanzas/facturas');
  await page.getByLabel('Tipo de documento').selectOption('sale');
  await page.getByLabel('Documento', { exact: true }).selectOption(sale.id);
  await page.getByRole('button', { name: 'Contabilizar documento' }).click();
  await expect(page.getByText(/contabilizado/i)).toBeVisible();
  await page.getByLabel('Número de factura').fill('F-0001');
  await page.getByRole('button', { name: 'Emitir factura' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'F-0001' })).toBeVisible();

  // Pagos: cobro en efectivo imputado a la factura.
  await page.goto('/finanzas/pagos');
  await page.getByLabel('Imputar F-0001').check();
  await expect(page.getByText('Monto del cobro').locator('..')).toContainText('100');
  await page.getByRole('button', { name: 'Registrar' }).click();

  // La factura queda pagada con saldo 0.
  await page.goto('/finanzas/facturas');
  const row = page.getByRole('listitem').filter({ hasText: 'F-0001' });
  await expect(row.getByText('Pagada')).toBeVisible();
  await expect(row).toContainText('Saldo 0');
});
