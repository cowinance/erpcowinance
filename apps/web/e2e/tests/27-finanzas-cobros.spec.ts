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

  /**
   * Acá había un bloque que creaba siete cuentas, un período y el mapa rol→cuenta. Ya no hace
   * falta ninguna de las tres cosas: desde `45cdb17` la finca nueva nace con el plan de cuentas
   * completo, el mapa de posteo cableado en `system_settings` y los períodos del ejercicio en
   * curso. Los siete `INSERT` chocaban contra los códigos sembrados, devolvían 409, y el mapa
   * quedaba armado con `undefined`.
   *
   * Sacarlo no debilita el spec: lo acerca a lo que hace un productor de verdad, que es facturar
   * y cobrar sobre el plan que le vino, sin construir contabilidad a mano. Que el bootstrap deje
   * todo eso listo lo verifica `26-finanzas`.
   */

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
