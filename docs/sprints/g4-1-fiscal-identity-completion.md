# G4-1 · Identidad fiscal venezolana — cierre

**Fecha:** 2026-07-25 · **Vertical:** G4 facturación electrónica (Venezuela) · **Etapa:** 1 de 5

Primera etapa de contenido fiscal, después de G4-0 (Venezuela como país soportado, `cd0a183`).
Entrega la identidad tributaria de las dos puntas de una operación: quién emite y a quién se le
emite.

---

## Por qué la identidad va primero

Un comprobante venezolano no se sostiene sin RIF válido y sin saber la condición del receptor. Si
esos dos datos se dejan para el final, la numeración y el motor de impuestos se construyen sobre
identidades que después hay que corregir hacia atrás — y en facturación corregir hacia atrás
significa notas de crédito, no un `UPDATE`.

---

## Lo que se entregó

### La regla vive en el dominio

`packages/domain/src/tax/`:

- **`rif.ts`** — `parseRif`, `isValidRif`, `rifCheckDigit`, `completeRif`, `normalizeRif`.
- **`taxpayer.ts`** — condición ante el IVA y sus predicados derivados.

### El dígito verificador, no un regex

El último dígito del RIF **se calcula** a partir de los otros nueve:

```
suma  = valor(letra) + Σ (dígito_i × peso_i)   con pesos [3,2,7,6,5,4,3,2]
dv    = 11 − (suma mód 11),  y si dv ≥ 10 → 0
```

Un regex acepta `J-00123072-4`: forma correcta, número equivocado. En una factura eso no es un
detalle — el RIF errado del cliente invalida el comprobante y el crédito fiscal que ese cliente
pretenda descontar con él.

**Cómo se verificó que el algoritmo es el correcto.** El riesgo real acá no era escribir mal el
código sino implementar bien un algoritmo equivocado: los tests derivados del propio cálculo se
habrían equivocado en coro y todo estaría verde. Por eso el test ancla usa un **RIF real y público**
que no salió de este código — PDVSA Petróleo, S.A. es `J-00123072-6`, y el algoritmo reproduce ese
6. Se contrastó además con dos implementaciones independientes, que coinciden en la tabla de letras
(`V=4, E=8, J=12, P=16, G=20`) y en los pesos.

### La condición ante el IVA necesita las DOS puntas

`ordinario` · `especial` · `formal` · `no_contribuyente`.

- Lo que YO soy decide si cobro IVA en mis ventas (`chargesVat`).
- Lo que es MI CLIENTE decide si me retiene al pagarme (`withholdsVat`).

`saleHasVatWithholding(emisor, cliente)` combina las dos, y es la que importa: el productor es
**ordinario** y no retiene a nadie, pero si le vende a un frigorífico designado **especial**, el
frigorífico le retiene el 75% o el 100% del IVA facturado. **La factura dice un número y el banco
muestra otro.** Sin la condición de la contraparte guardada, esa diferencia aparece más tarde como
un faltante de cobranza que nadie sabe explicar.

Las **alícuotas y los porcentajes de retención NO viven en el dominio**: son configuración, porque
cambian por providencia. En el código, cada cambio de alícuota sería un deploy.

### Validación condicional por país

`apps/api/src/common/fiscal-identity.ts` decide **cuándo** aplicar la regla; la aritmética queda en
el dominio. Un tenant argentino carga un CUIT y uno mexicano un RFC: validarlos con el algoritmo
venezolano rechazaría identificaciones perfectamente válidas. Para países sin regla propia el
identificador se guarda tal cual y la clave normalizada va NULL — **NULL es «sin regla», no «sin
RIF»**.

### Migración `0017_fiscal_identity.sql`

`taxpayer_condition`, `legal_name`, `fiscal_address` y `tax_id_normalized` en `companies` y
`business_partners`.

**Dos decisiones que costaron una reescritura:**

1. **La unicidad NO puede ir sobre `tax_id`.** Es texto libre: `J-00123072-6` y `J001230726` son el
   mismo RIF y el índice los dejaría pasar como distintos — sensación de guardarraíl sin serlo. Y
   una finca con un duplicado ya cargado haría **fallar la migración y con ella el arranque de la
   API**; un problema de datos viejos no puede dejar la app abajo. Por eso el índice único va sobre
   `tax_id_normalized`, columna nueva que nace NULL en todo lo existente: no puede chocar al
   crearse, y a la vez es imposible cargar dos veces el mismo RIF de acá en adelante.
2. **`taxpayer_condition` sin DEFAULT.** NULL significa «todavía no se declaró», que es la verdad
   para todo lo ya cargado. Un `DEFAULT 'ordinario'` afirmaría de cada cliente existente algo que
   nadie verificó, y esa mentira se arrastraría al primer libro de ventas.

Lo viejo se normaliza **cuando alguien edita ese socio**, no con un `UPDATE` masivo a ciegas sobre
datos que pueden ser de otro país o estar a medio cargar.

### La unicidad es de base, no de servicio

Dos altas simultáneas del mismo cliente pasarían las dos por un chequeo previo en código. El índice
las frena; `rethrowDuplicateFiscalId` traduce el choque a un 409 que se puede mostrar.

### Web

El formulario de socios nace con la etiqueta del país (`RIF` vs `CUIT / identificación fiscal`),
valida el dígito **en el cliente con el mismo `isValidRif` del dominio** (la regla vive una sola
vez; esto solo adelanta el aviso, el servidor valida igual), y el listado marca **«Retiene IVA»** en
los especiales — quien carga la cobranza tiene que verlo sin abrir la ficha.

---

## Verificación

- **32 tests nuevos**: 12 del RIF (incluido el ancla real), 8 de la condición, 12 de integración.
- **Contra la app corriendo**, tenant venezolano: alta con `j00123072 6` → guardado
  `J-00123072-6` / `J001230726`; `J-00123072-4` → 400 `tax.invalid_rif.bad_check_digit`;
  `J001230726` repetido → 409 `commerce.duplicate_tax_id`.
- **Country-conditional en la UI real**: la finca venezolana ve «RIF» con validación en vivo (borde
  rojo + botón deshabilitado); la argentina ve «CUIT / identificación fiscal» sin validar nada.
- Gate completo verde, sin consola con errores.

---

## Lo que sigue

**G4-2 · Numeración fiscal.** Es el corazón del módulo y donde la decisión del productor pesa más:
emite por **forma libre de imprenta autorizada**, así que **el correlativo es nuestro** (con máquina
fiscal lo asignaría el aparato y solo lo registraríamos). Hay que llevar **dos** numeraciones sin
huecos en el mismo documento: número de factura y **número de control**.

Después: G4-3 motor de impuestos (IVA por alícuota, IGTF — que depende del medio de pago y por lo
tanto se conoce **al cobrar, no al facturar**—, tasa BCV), G4-4 comprobantes y G4-5 libros de IVA.
