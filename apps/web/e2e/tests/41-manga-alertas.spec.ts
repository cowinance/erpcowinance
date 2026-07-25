import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * Alertas de la tarjeta de manga (paridad web ↔ móvil).
 *
 * La regla vive en `@cowinance/domain` y la comparten los dos canales. Este recorrido comprueba lo
 * que importa en la manga real: que el **retiro activo** se vea —es la alerta que impide mandar el
 * animal a faena— y que las alertas accionables lleven al modo que las resuelve, sin obligar al
 * operario a recordar y navegar con guantes puestos.
 */
test('manga: la tarjeta avisa retiro activo y las alertas accionables cambian de modo', async ({ page }) => {
  const u = uniqueUser('manga');
  await registerAndAutoLogin(page, u);

  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  // Un animal SIN lote y SIN pesaje: dos alertas accionables aseguradas.
  const animal = await (
    await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'MANGA-1', sex: 'F', category_code: 'vaca' } })
  ).json();

  // Producto con retiro en carne → el tratamiento deja el animal no apto para faena.
  const producto = await (
    await page.request.post(`${API_URL}/products-veterinary`, {
      headers: auth,
      data: { name: 'Antibiótico E2E', type: 'antibiotic', withdrawal_meat_days: 21 },
    })
  ).json();
  await page.request.post(`${API_URL}/treatments`, {
    headers: auth,
    data: { animal_id: animal.id, product_id: producto.id, applied_at: new Date().toISOString().slice(0, 10) },
  });

  await page.goto('/manga');
  await page.getByRole('button', { name: 'EMPEZAR' }).click();

  await page.getByLabel('Caravana del animal').fill('MANGA-1');
  await page.getByRole('button', { name: 'BUSCAR', exact: true }).click();

  // 1. El retiro: en la tarjeta, y NO es un botón — no hay nada que capturar, hay que esperar.
  const retiro = page.getByText(/RETIRO ACTIVO/);
  await expect(retiro).toBeVisible();
  await expect(page.getByRole('button', { name: /RETIRO ACTIVO/ })).toHaveCount(0);

  // 2. Las accionables sí son botones, y llevan al modo que las resuelve. Lo que se comprueba es
  //    el EFECTO —qué formulario quedó en pantalla—, no que el chip del modo esté marcado.
  await page.getByRole('button', { name: /SIN LOTE/ }).click();
  await expect(page.getByRole('combobox')).toBeVisible(); // selector de lote destino
  await expect(page.getByRole('button', { name: /MOVER/ })).toBeVisible();

  await page.getByRole('button', { name: /SIN PESAJE/ }).click();
  await expect(page.getByLabel('Peso en kilogramos')).toBeVisible();
});
