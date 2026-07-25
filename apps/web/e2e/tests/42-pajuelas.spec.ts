import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * Inventario criogénico (GT-1 + GT-2), el recorrido real del productor: arma el termo, compra
 * pajuelas, las ubica y pierde una.
 *
 * Lo que este recorrido prueba y ningún test unitario puede probar: que el saldo que se ve en el
 * listado sea de verdad DERIVADO de las unidades. Si quedara un contador escondido en algún lado,
 * dar de baja una pajuela desde la pantalla de inventario dejaría el listado mostrando 20.
 */
test('termo, pajuelas ubicadas y saldo derivado de las unidades', async ({ page }) => {
  const u = uniqueUser('cryo');
  await registerAndAutoLogin(page, u);

  // 1. La estructura del termo: el caso que describe el productor.
  await page.goto('/genetica/termos');
  await page.getByLabel('Número del termo').fill('207');
  await page.getByRole('button', { name: 'Agregar termo' }).click();
  // El termo elegido viaja por la URL, así que acá hay una navegación de verdad. Ver el panel NO
  // alcanza: llega en el HTML del servidor, y lo que se escriba antes de que React hidrate queda en
  // el DOM pero no en el estado del componente — el formulario se ve lleno y el botón sigue
  // deshabilitado. Por eso se espera a que la página termine de cargar.
  await page.getByRole('link', { name: /^207/ }).click();
  await expect(page.getByText(/Termo 207/)).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Número de canasta').fill('2');
  await page.getByLabel('Color de la canasta').selectOption('azul');
  await page.getByRole('button', { name: 'Agregar canasta' }).click();
  await expect(page.getByText('azul 2')).toBeVisible();

  await page.getByRole('button', { name: 'Gobelete' }).first().click();
  await page.getByLabel('Número de gobelete').fill('5');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();

  // 1b. El nitrógeno (GT-4): lo primero que hay que mirar de un termo, porque si se seca lo de
  //     adentro no importa. Con una sola medición NO se puede proyectar, y la pantalla lo dice en
  //     vez de quedarse en blanco —que se leería como «está todo bien», que es justo lo que no se
  //     sabe—.
  await expect(page.getByText(/Todavía no se cargó ninguna medición/)).toBeVisible();

  const hoy = new Date();
  const haceDias = (n: number) => new Date(hoy.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  for (const [fecha, cm] of [[haceDias(20), '60'], [haceDias(10), '22']] as const) {
    await page.getByLabel('Fecha de la medición').fill(fecha);
    await page.getByLabel('Nivel en centímetros').fill(cm);
    await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
    // Se espera a que la medición aparezca en el historial, no a que la red se calme: el formulario
    // se vacía al guardar, así que escribir la siguiente antes de tiempo la borra el propio `onOk`.
    await expect(page.getByText(`${fecha}: ${cm} cm`)).toBeVisible({ timeout: 20_000 });
  }
  // 38 cm en 10 días = 3,8 cm/día; quedan 22 → menos de una semana. Con 14 días de proveedor, eso
  // ya es urgencia: el umbral es sobre el tiempo de reposición, no sobre el nivel.
  await expect(page.getByText('Urgente')).toBeVisible();
  await expect(page.getByText(/se pierde todo lo que hay adentro/)).toBeVisible();

  // 2. La compra: 20 pajuelas que todavía nadie cargó en el termo.
  await page.goto('/genetica');
  await page.getByLabel('Código de partida').fill('SANSAO-GYR');
  await page.getByLabel('Toro externo').fill('Sansão');
  await page.getByLabel('Pajuelas iniciales').fill('20');
  await page.getByRole('button', { name: 'Agregar partida' }).click();
  // «Sin ubicar» es lo honesto: existen, pero nadie puede ir a buscarlas todavía.
  await expect(page.getByRole('link', { name: /20 sin ubicar/ })).toBeVisible();

  // 3. El inventario físico: se eligen todas y se mandan al gobelete de una vez, que es como se
  //    trabaja con la tapa abierta.
  await page.getByRole('link', { name: /20 sin ubicar/ }).click();
  await page.waitForLoadState('networkidle'); // misma razón que arriba: hidratar antes de tocar
  await page.getByRole('button', { name: /Elegir las 20 sin ubicar/ }).click();
  await page.getByLabel('Gobelete destino').selectOption({ index: 1 });
  await page.getByRole('button', { name: /^Ubicar/ }).click();

  // Ubicar 20 de una vez es un round-trip más el re-render de la tabla entera: se espera al
  // post-estado con margen, en vez de al primer texto que aparezca.
  await expect(page.getByRole('button', { name: /Elegir las 0 sin ubicar/ })).toBeVisible({ timeout: 20_000 });

  // La etiqueta sale de la regla compartida del dominio, la misma que usará la lista de retiro —
  // por eso aparece DOS veces en la pantalla: en el selector de destino y en cada fila. Se busca la
  // celda, porque un `<option>` dentro de un select cerrado nunca está «visible».
  await expect(page.getByRole('cell', { name: '207 · azul 2 · gob. 5' }).first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(20);

  // 4. Una se descongela y no se usa: es una pérdida, no un sobrante.
  await page.locator('select[aria-label^="Dar de baja"]').first().selectOption('lost');
  await expect(page.getByText('Perdida').first()).toBeVisible();

  // 5. Y el saldo del listado la sigue, porque se cuenta y no se guarda.
  await page.goto('/genetica');
  await expect(page.getByText('19', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /sin ubicar/ })).toHaveCount(0);
});
