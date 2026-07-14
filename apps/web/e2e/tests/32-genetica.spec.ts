import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web de Genética (G-3): crear una partida de semen en /genetica y ajustar su saldo de pajuelas
 * con +/−, viendo el saldo actualizado. Reglas (no-negativo, consumo en inseminación) en integración.
 */
test('genética: crear partida de semen y ajustar el saldo de pajuelas', async ({ page }) => {
  const u = uniqueUser('gen');
  await registerAndAutoLogin(page, u);

  await page.goto('/genetica');
  await expect(page.getByRole('heading', { name: 'Genética' })).toBeVisible();

  // Alta de partida con toro externo y 3 pajuelas.
  await page.getByLabel('Código de partida').fill('TORO-USA-1');
  await page.getByLabel('Toro externo').fill('Bull USA 88');
  await page.getByLabel('Pajuelas iniciales').fill('3');
  await page.getByRole('button', { name: 'Agregar partida' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'TORO-USA-1' });
  await expect(row).toBeVisible();
  await expect(row.getByText('3', { exact: true })).toBeVisible();

  // Sumar una pajuela → 4.
  await row.getByRole('button', { name: 'Sumar pajuela TORO-USA-1' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'TORO-USA-1' }).getByText('4', { exact: true })).toBeVisible();

  // Restar dos → 2.
  await page.getByRole('listitem').filter({ hasText: 'TORO-USA-1' }).getByRole('button', { name: 'Restar pajuela TORO-USA-1' }).click();
  await page.getByRole('listitem').filter({ hasText: 'TORO-USA-1' }).getByRole('button', { name: 'Restar pajuela TORO-USA-1' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'TORO-USA-1' }).getByText('2', { exact: true })).toBeVisible();
});
