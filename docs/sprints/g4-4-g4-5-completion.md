# G4-4 comprobantes + G4-5 libro de ventas — cierre del vertical

**Fecha:** 2026-07-25 · **Vertical:** G4 facturación electrónica (Venezuela) · **Etapas:** 4 y 5 de 5

Con esto **G4 queda cerrado** y con él la Fase 2 del catálogo: **36 de 45 módulos**. Los 9 pendientes
son todos Fase 3-4.

---

## G4-4 · Comprobantes

Es donde convergen las tres etapas anteriores. La emisión hace, **en una sola transacción**:

1. **Validar identidad y líneas** — antes de tocar la numeración. Un comprobante rechazado por falta
   de RIF no tiene por qué haber pedido un número, aunque el rollback se lo devuelva.
2. **Congelar el desglose** con las alícuotas de hoy.
3. **Tomar los dos correlativos.**
4. **Insertar.**

### Se construye sobre `invoices`, no en una tabla nueva

La factura fiscal **es** la factura. Dos tablas serían dos verdades del mismo documento, y el saldo
que los pagos cancelan ya cuelga de ésta. Una `invoices` recibida, o de un tenant no venezolano,
deja los campos fiscales en NULL.

### El snapshot congelado

`invoices.fiscal_snapshot` guarda el desglose **y los datos fiscales de las dos puntas** al momento
de emitir. Es la decisión más importante de la etapa: las alícuotas cambian por providencia, y si el
desglose se recalculara al leer, **una factura de hace seis meses cambiaría de monto sola**. Lo mismo
con las identidades: si el cliente corrige su RIF mañana, el comprobante ya impreso no puede
reescribirse. Un comprobante emitido es un hecho, no una consulta.

### Anular no libera el número

`voided_at`, no `deleted_at`. Un comprobante anulado **sigue existiendo y sigue ocupando su lugar en
el correlativo** — devolverlo dejaría el hueco que hay que justificar ante el SENIAT. Y la anulación
exige motivo, porque queda en el libro.

### `tax_rate` no alcanzaba: hizo falta `vat_treatment` por línea

Con `tax_rate = 0` no se puede saber si una línea es **exenta** o **no sujeta**, que es justo la
distinción que el libro necesita en columnas separadas. Y deducir el tratamiento comparando la tasa
contra las alícuotas configuradas se rompe solo: dos tratamientos pueden compartir tasa, y la tasa
cambia mientras las líneas viejas se quedan con la de su momento.

Una línea **sin tratamiento declarado se grava**, no se exime: equivocarse hacia gravado se corrige
con una nota de crédito; equivocarse hacia exento es IVA no cobrado que igual hay que enterar.

---

## G4-5 · Libro de ventas

Se arma desde el snapshot congelado, no recalculando: el libro tiene que decir lo que decía el papel.

**Los anulados aparecen, en cero.** Es la parte que suele hacerse mal: sacarlos dejaría un salto en
el correlativo dentro del libro, que es exactamente lo que hay que poder no tener. Figuran con su
número y sus importes en cero, y hay un test que recorre el correlativo entero verificando que no
haya saltos.

Los totales por alícuota se agrupan **por tratamiento Y tasa**: si la alícuota general cambió a mitad
de mes, el libro muestra las dos por separado, no una suma que no corresponde a ninguna.

---

## Dos huecos que aparecieron al probar contra la app real

Los dos los encontré usando el módulo, no leyéndolo — ninguna suite los habría mostrado.

1. **El RIF de la empresa que emite no tenía por dónde cargarse.** Existía la identidad fiscal del
   socio de negocio (G4-1) y faltaba la propia: sin ella no se puede emitir un solo comprobante, y
   no había endpoint ni pantalla. Se agregó `IssuerService` (`GET`/`PUT /tax/issuer`), con la
   **misma** `resolveFiscalId` que el socio — dos validaciones distintas para el mismo dato terminan
   aceptando en una punta lo que la otra rechaza.
2. **`companies` no tenía `legal_name`.** Se la había dado a `business_partners` en 0017 y la
   empresa quedó sin ella. Faltando en la punta emisora es peor: sale mal en **todos** los
   comprobantes.

También se corrigió un fallo de diseño: `references_invoice_id` se **ignoraba en silencio** en una
factura, porque solo se cargaba cuando el tipo era nota. Quien la emitía creía que quedaba vinculada.
Un dato que se descarta sin avisar es peor que un rechazo.

---

## El guardarraíl de migraciones funcionó sobre mí

Editar `0020` después de que ya se hubiera aplicado a la base local **abortó el arranque** con el
mensaje correcto. Es el comportamiento buscado: una migración aplicada es historia. Se resolvió
reseteando la base de desarrollo (`rm -rf apps/api/.data/pglite`), que es lo que corresponde en local
y no habría sido opción en producción — ahí habría hecho falta una migración nueva.

---

## Verificación

**20 tests de integración** (emisión, congelamiento, notas de crédito, anulación, libro) sobre los
1365 previos.

**Y el ciclo completo contra la app corriendo**, con un tenant venezolano real:

| Paso | Resultado |
|---|---|
| Cargar RIF propio inválido | 400 `tax.invalid_rif.bad_check_digit` |
| Cargar RIF propio válido | `can_issue: true` |
| Emitir desde una venta | control `00-00000001`, documento `00000001`, base 1000 · IVA 160 · **total 1160 USD** |
| Anular sin motivo | rechazado |
| Anular con motivo | conserva su número; el próximo control queda en `00-00000003`, **no vuelve al 2** |
| Libro de julio | 2 comprobantes, 1 anulado en cero, correlativo sin saltos, total 1160 USD |

La pantalla `/facturacion` muestra series con aviso de lote bajo, alícuotas en porcentaje y los
comprobantes emitidos con el anulado marcado.

---

## Lo que queda fuera, dicho explícitamente

- **Sin bolívares ni convertibilidad** — decisión del productor, tomada con el riesgo legal sobre la
  mesa (la factura venezolana se expresa en Bs). Ver la memoria del proyecto.
- **Sin IGTF** — es contribuyente ordinario y el IGTF recae sobre todo en los especiales.
- **Sin libro de COMPRAS.** El de ventas cubre lo que la finca emite; el de compras necesita cargar
  el IVA soportado de las facturas recibidas, que hoy entran por `purchases` sin tratamiento por
  línea. La columna `purchase_lines.vat_treatment` ya está puesta para cuando se haga.
- **Sin PDF imprimible.** El comprobante existe con todos sus datos y se puede consultar; falta el
  formato para la forma libre, que depende del diseño físico del lote de la imprenta.
- **Sin botón de emitir desde la pantalla de ventas.** Hoy se emite por API. La pantalla de
  facturación muestra lo emitido y la configuración.
