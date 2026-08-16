import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web de Finanzas (F-4a): crear cuentas + período en /finanzas, postear un asiento balanceado en
 * /finanzas/asientos y verlo reflejado en /finanzas/sumas-y-saldos. Reglas en integración.
 */
test('finanzas: plan de cuentas, asiento balanceado y sumas y saldos', async ({ page }) => {
  const u = uniqueUser('fin');
  await registerAndAutoLogin(page, u);

  await page.goto('/finanzas');
  await expect(page.getByRole('heading', { name: 'Finanzas' })).toBeVisible();

  /**
   * La finca nueva YA VIENE con plan de cuentas (`45cdb17`): 42 cuentas, entre ellas `1.1.01 Caja y
   * bancos` y `4.1.01 Venta de ganado`. Este spec creaba esos dos códigos a mano y desde entonces
   * chocaba con «Ya existe una cuenta con el código 1.1.01».
   *
   * Se afirma primero que el plan viene sembrado —comportamiento nuevo que no cubría nadie y que
   * es la razón del cambio— y después se agrega UNA cuenta propia, que es lo que este spec venía a
   * probar: que el alta funciona. Con un código libre, no con uno del plan base.
   */
  await expect(page.getByRole('cell', { name: 'Caja y bancos', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Venta de ganado', exact: true })).toBeVisible();

  await page.getByLabel('Código de cuenta').fill('4.1.99');
  await page.getByLabel('Nombre de cuenta').fill('Ventas varias');
  await page.getByLabel('Tipo de cuenta').selectOption('income');
  await page.getByRole('button', { name: 'Agregar cuenta' }).click();
  await expect(page.getByRole('cell', { name: 'Ventas varias', exact: true })).toBeVisible();

  await page.getByLabel('Nombre del período').fill('Ejercicio 2030');
  await page.getByLabel('Inicio del período').fill('2030-01-01');
  await page.getByLabel('Fin del período').fill('2030-12-31');
  await page.getByRole('button', { name: 'Agregar período' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ejercicio 2030' })).toBeVisible();

  // Asiento balanceado: D Caja y bancos 100 / H Ventas varias 100 — una cuenta del plan sembrado
  // y otra propia, que es la mezcla que hace cualquier finca de verdad.
  await page.goto('/finanzas/asientos');
  await page.getByLabel('Fecha del asiento').fill('2030-05-10');
  await page.getByLabel('Concepto').fill('Venta contado');
  await page.getByLabel('Cuenta línea 1').selectOption({ label: '1.1.01 · Caja y bancos' });
  await page.getByLabel('Debe línea 1').fill('100');
  await page.getByLabel('Cuenta línea 2').selectOption({ label: '4.1.99 · Ventas varias' });
  await page.getByLabel('Haber línea 2').fill('100');
  await page.getByRole('button', { name: 'Postear' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: 'Venta contado' });
  await expect(entry).toBeVisible();
  await expect(entry.getByText('Posteado')).toBeVisible();

  // Sumas y saldos: Caja con Debe 100, Ventas con Haber 100.
  await page.goto('/finanzas/sumas-y-saldos');
  await page.getByLabel('Desde').fill('2030-01-01');
  await page.getByLabel('Hasta').fill('2030-12-31');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  const cajaRow = page.getByRole('row').filter({ hasText: 'Caja y bancos' });
  await expect(cajaRow.getByText('100', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Ventas varias' })).toBeVisible();
});
