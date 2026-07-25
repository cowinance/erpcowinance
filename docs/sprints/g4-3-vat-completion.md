# G4-3 · Motor de IVA — cierre

**Fecha:** 2026-07-25 · **Vertical:** G4 facturación electrónica (Venezuela) · **Etapa:** 3 de 5

---

## Decisión que redujo la etapa a la mitad

El diseño previsto incluía tasa BCV por comprobante y equivalente en bolívares, porque la factura
venezolana legalmente se expresa en Bs. **El productor lo descartó explícitamente:** *«todo en usd,
no te compliques con bs, no quiero convertibilidad ni nada de eso, todo base a usd»*.

Se le había planteado el riesgo antes de que decidiera, así que **queda como decisión suya y no se
vuelve a levantar**. Consecuencias asumidas: sin tasa de cambio por documento, sin columnas en Bs,
sin reexpresión. Si el contador algún día lo exige, es una etapa nueva — no un olvido.

El módulo entero no conoce más de una moneda, a propósito.

**IGTF también queda fuera**, y por una razón además de la simplicidad: el productor es
**contribuyente ordinario**, no especial, y el IGTF recae principalmente sobre los sujetos pasivos
especiales. Sumarlo hoy sería modelar un impuesto que probablemente no le aplica.

---

## Por qué no alcanzaba con `computeDocumentTotals`

Esa función ya existía (C-2/C-3) y da subtotal, impuesto y total. El comprobante venezolano necesita
dos cosas que ella no puede dar:

1. **Base imponible e IVA separados POR ALÍCUOTA.** Un único `tax_total` los funde.
2. **Distinguir exento de no sujeto.** Con `tax_rate = 0` para ambos quedan indistinguibles — y el
   libro de ventas los necesita en columnas distintas.

`computeVatBreakdown` **recibe el total de línea ya calculado** en vez de recalcularlo. Es
deliberado: recalcular sería una segunda regla para el mismo número, y el día que difiriera, el
comprobante y la venta mostrarían importes distintos.

---

## El redondeo va por grupo, no por línea

No es un detalle de implementación. El comprobante imprime «base imponible» e «IVA» de cada
alícuota, y el segundo tiene que ser **exactamente** el primero por la tasa. Redondeando línea por
línea y sumando, el IVA impreso puede no coincidir con su propia base: un comprobante que no cierra
contra sí mismo.

Ejemplo real del test: tres líneas de 0,10 al 16%.

| | Cuenta | IVA |
|---|---|---|
| Por línea | `round(0.10×0.16)` × 3 | **0,06** |
| Por grupo | `round(0.30×0.16)` | **0,05** ← el que va impreso |

Y como dos formas de sumar el mismo documento que dan distinto es el descuadre que después nadie
sabe explicar, la diferencia **se expone** en `rounding_delta` en vez de esconderse. Casi siempre
vale 0; cuando no, son centavos que G4-4 va a poder mostrar en lugar de tener dos números en
silencio.

---

## Las alícuotas son configuración, no código

`companies.vat_rates` (jsonb, migración `0019`). En Venezuela las alícuotas cambian por providencia:
escritas en el código, cada cambio sería un deploy — y entre el cambio oficial y el deploy la finca
estaría facturando con la tasa vieja.

- **jsonb y no tres columnas:** el conjunto se lee y se guarda entero, y una cuarta alícuota no
  obliga a migrar la tabla.
- **Fracción (0.16), igual que `tax_rate` en compras y ventas.** Dos convenciones para el mismo
  concepto es un error de conversión esperando el momento.
- **Sin DEFAULT con las tasas de hoy.** Escribir 0.16 afirmaría cuál es la alícuota vigente en el
  momento en que alguien corra la migración, y esa afirmación envejece sola. NULL es «sin
  configurar», y la alícuota ausente se trata como cero — visible en el comprobante (IVA en 0) en
  vez de silenciosa.
- **Se validan al GUARDAR, no al facturar.** Una alícuota cargada como `16` en vez de `0.16` no
  falla: factura 1600% de IVA, y se descubre en el comprobante que ya salió.
- **Exento y no sujeto no aceptan alícuota.** Aceptarla dejaría creíble que se puede gravar lo que
  por definición no se grava.

---

## Verificación

**28 tests** (19 de dominio, 9 de integración), incluidos los dos que definen la etapa: el redondeo
por grupo y la exposición del delta. Gate completo verde.

`POST /tax/vat-preview` existe para que la UI muestre el impuesto con la **misma regla** que va a
llevar el comprobante, y no con una cuenta aproximada del frontend que después no coincide con el
papel.

---

## Lo que sigue

**G4-4 · Comprobantes.** Es donde se juntan las tres etapas: identidad (G4-1) + los dos correlativos
(G4-2) + el desglose (G4-3), todo dentro de **una sola transacción** — que es lo que hace que un
comprobante fallido no queme un número. Incluye factura, nota de crédito y nota de débito con
referencia al documento original, y el formato legal imprimible.

Ahí también entra la UI que hoy falta: alta de series y alta de alícuotas, que son configuración que
el productor tiene que poder tocar sin API.

Después, **G4-5 · Libros de IVA** (ventas y compras), que es lo que realmente usa el contador y para
lo que ya está puesta la separación exento / no sujeto.
