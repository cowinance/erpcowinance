import fs from 'fs';
import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E del importador de animales (P2 P-e): recorrido completo del asistente sobre
 * un tenant FRESCO (sin duplicados preexistentes) — subir → mapear (auto) →
 * previsualizar → confirmar → resultado, con reporte por-fila, descarga CSV y
 * enlace al animal creado. El CSV mezcla válidas y una inválida (sexo) para
 * ejercer `completed_with_errors` y el detalle por fila.
 */
test('importar animales por CSV: subir → mapear → preview → confirmar → resultado + reporte + CSV', async ({ page }) => {
  const u = uniqueUser('imp');
  await registerAndAutoLogin(page, u);

  // Entrada desde el hato.
  await page.goto('/animales');
  await page.getByRole('link', { name: 'Importar' }).click();
  await page.waitForURL('**/animales/importar');

  // 1) Subir un CSV (2 válidas + 1 inválida por sexo).
  const csv = ['Caravana,Sexo,Categoria', 'IMP-A,F,vaca', 'IMP-B,M,toro', 'IMP-C,X,vaca'].join('\n');
  await page.getByLabel(/Archivo CSV/).setInputFiles({ name: 'rebano.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Subir y continuar' }).click();

  // 2) Mapear: el mapeo se auto-sugiere; continuar a la previsualización.
  const previewBtn = page.getByRole('button', { name: 'Previsualizar' });
  await expect(previewBtn).toBeVisible(); // el paso de mapeo se cargó (fields + auto-sugerencia)
  await previewBtn.click();

  // 3) Preview: conteos exactos (2 válidas, 1 inválida). Exact para no chocar con
  // el aria-live ni con «Inválidas» (que contiene «válidas» como subcadena).
  await expect(page.getByText('Válidas', { exact: true })).toBeVisible();
  await expect(page.getByText('Inválidas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 4) Confirmar (puerta irreversible).
  await expect(page.getByText(/Se crearán/)).toBeVisible();
  await page.getByRole('button', { name: /Importar 2 animales/ }).click();

  // 5) Resultado: esperar estado terminal (con avisos por la fila inválida).
  // Banner exacto (no el aria-live sr-only, que lleva sufijo con los conteos).
  await expect(page.getByText('Importación completada con avisos.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Creados', { exact: true })).toBeVisible();

  // Reporte por fila: las caravanas aparecen.
  await expect(page.getByRole('cell', { name: 'IMP-A' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IMP-C' })).toBeVisible();

  // Descarga CSV: el reporte anotado contiene los encabezados y los datos.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Descargar reporte/ }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('reporte-importacion');
  const filePath = await download.path();
  const content = fs.readFileSync(filePath, 'utf8');
  expect(content).toContain('estado');
  expect(content).toContain('animal_id');
  expect(content).toContain('IMP-A');
  expect(content).toContain('IMP-C');

  // Enlace a un animal creado → su ficha.
  await page.getByRole('row', { name: /IMP-A/ }).getByRole('link', { name: 'Ver' }).click();
  await page.waitForURL(/\/animales\/[0-9a-f-]{36}/);
});
