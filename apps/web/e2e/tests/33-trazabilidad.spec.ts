import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web de Trazabilidad (T-3): emitir una guía de traslado en /trazabilidad y avanzar su estado
 * (emitida → en tránsito → completada). Reglas (transiciones, validaciones) en integración.
 */
test('trazabilidad: emitir una guía y avanzar su estado', async ({ page }) => {
  const u = uniqueUser('traza');
  await registerAndAutoLogin(page, u);

  await page.goto('/trazabilidad');
  await expect(page.getByRole('heading', { name: 'Trazabilidad' })).toBeVisible();

  await page.getByLabel('Número de guía').fill('DTe-1001');
  await page.getByLabel('Cabezas').fill('50');
  await page.getByRole('button', { name: 'Emitir guía' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'DTe-1001' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Emitida')).toBeVisible();

  await row.getByRole('button', { name: 'En tránsito' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'DTe-1001' }).getByText('En tránsito')).toBeVisible();

  await page.getByRole('listitem').filter({ hasText: 'DTe-1001' }).getByRole('button', { name: 'Completar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'DTe-1001' }).getByText('Completada')).toBeVisible();
});
