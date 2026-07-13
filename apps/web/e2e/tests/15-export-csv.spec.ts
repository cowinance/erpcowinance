import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E del export CSV robusto (P9-3): descarga real del reporte de Sanidad y verifica (1) el
 * desglose incluido y (2) la neutralización de inyección de fórmulas — un producto llamado
 * «=SUM(A1)» debe salir prefijado con apóstrofo, no como fórmula ejecutable en Excel/Sheets.
 */
test('export CSV: descarga con desglose y neutraliza inyección de fórmulas', async ({ page }) => {
  const u = uniqueUser('csv');
  await registerAndAutoLogin(page, u);
  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  // Producto con nombre malicioso (inyección de fórmula) → aparece en el desglose por producto.
  const prod = await (await page.request.post(`${API_URL}/products-veterinary`, { headers: auth, data: { name: '=SUM(A1)', type: 'vaccine' } })).json();
  const a = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'CSV1', sex: 'M', category_code: 'novillo' } })).json();
  await page.request.post(`${API_URL}/vaccinations`, { headers: auth, data: { animal_id: a.id, product_id: prod.id } });

  await page.goto('/reportes');
  await page.getByRole('button', { name: 'Sanidad' }).click();
  await expect(page.getByText('Vacunas por producto')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar CSV/i }).click(),
  ]);
  const content = readFileSync(await download.path(), 'utf8');

  expect(content).toContain('Concepto,Cantidad'); // header
  expect(content).toContain('Vacunas por producto'); // desglose incluido
  // Inyección neutralizada: la celda salió como '=SUM(A1) (apóstrofo), NO como fórmula cruda.
  expect(content).toContain("'=SUM(A1)");
  expect(content).not.toMatch(/(^|\n)=SUM\(A1\)/);
});
