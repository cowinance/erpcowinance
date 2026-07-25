# G4-2 · Numeración fiscal — cierre

**Fecha:** 2026-07-25 · **Vertical:** G4 facturación electrónica (Venezuela) · **Etapa:** 2 de 5

El corazón del módulo. La decisión del productor de emitir por **forma libre de imprenta
autorizada** —y no por máquina fiscal— es la que define esta etapa: **el correlativo es nuestro**.
Con máquina fiscal el número lo asigna el aparato y el sistema solo lo registra después.

---

## Dos números, no uno con dos formatos

| | Alcance | Origen |
|---|---|---|
| **Número de documento** | **uno por tipo** — factura y nota de crédito no se pisan | correlativo del emisor |
| **Número de control** | **único sobre todos los tipos** | lote de formas libres de la imprenta |

El número de control identifica **el papel**, no el documento: dos comprobantes distintos impresos
en la misma forma serían el mismo control. Esa diferencia de alcance —uno por tipo, el otro global—
es la razón de que sean dos series y no una tabla con dos columnas.

---

## Por qué NO una `sequence` de PostgreSQL

Era la solución obvia y es la equivocada: **las secuencias no vuelven atrás a propósito** (para no
serializar). Una emisión que falle después de pedir el número deja el hueco igual, y un hueco en un
correlativo fiscal hay que justificarlo ante el SENIAT.

La solución es tomar el número con `SELECT … FOR UPDATE` **dentro de la transacción del
comprobante**:

- Dos emisiones simultáneas se serializan en esa fila; la segunda espera y ve el número avanzado.
- Si el comprobante no se guarda, el `UPDATE` del contador vuelve atrás con él y el número queda
  libre. **El hueco no se produce.**

El costo es que la emisión queda serializada por empresa. Es deliberado: a ritmo de finca no se
nota, y es el único modo de que «sin huecos» sea verdad y no una intención.

Por lo mismo **no hay endpoint de asignación**: un «dame el próximo número» suelto sería
precisamente el modo de generar huecos. El número se toma desde la transacción que lo va a usar.

---

## Lo que costó una reescritura

`replace()` —cerrar la serie vigente y abrir la que la reemplaza— llamaba a `create()`, que abre su
**propia** transacción. O sea que hacía exactamente lo que su comentario decía evitar. Y el índice
único impide tener dos series activas a la vez, así que tampoco servía abrir primero: si el segundo
paso fallaba, la finca se quedaba **sin ninguna serie activa y sin poder facturar**. Se extrajo
`insertSeries(q, …)` para que las dos operaciones compartan la misma transacción.

---

## La verificación es la mitad del trabajo

**PGlite no puede probar esta etapa.** Es de una sola conexión: dos emisiones simultáneas no existen
ahí, el `FOR UPDATE` nunca llega a bloquear, y **los tests pasarían igual si lo borráramos**. Un
test que no puede fallar no prueba nada.

Por eso hay dos suites:

- `numbering.integration.test.ts` (14 tests, PGlite, en el gate) — consecutividad, independencia por
  tipo, control único entre tipos, agotamiento del lote, reemplazo, y **que un fallo devuelva el
  número**.
- `numbering-concurrency.integration.test.ts` (3 tests, **PostgreSQL real**, se saltea sin
  `PG_TEST_URL`) — 50 emisiones simultáneas, 40 con la mitad fallando, y un lote de 10 pedido 25
  veces.

**Prueba por mutación, que es lo que hace creíbles a los tres:** sacándole el `FOR UPDATE` al
servicio, las 50 emisiones simultáneas dieron **37 números distintos** — 13 comprobantes con número
repetido. Es el peor error posible del módulo, y se descubre cuando el cliente presenta dos facturas
iguales. Con el `FOR UPDATE` puesto: 50 de 50, sin huecos.

Para correrla:

```bash
docker compose up -d db && PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5434/postgres npx vitest run apps/api/src/modules/tax/numbering-concurrency
```

---

## Otras decisiones

- **`next_number` es el próximo a entregar**, no el último entregado: una serie nueva arranca en su
  primer número sin restarle uno a nada, y «agotada» es simplemente `next > range_to`.
- **El estado de la serie se DERIVA** (`seriesStatus`), no se guarda: un `health` en columna se
  desincroniza con el contador en cuanto se emite un comprobante.
- **Aviso ANTES de agotarse** (umbral 50): quedarse sin formas libres no es un inconveniente
  administrativo, es no poder facturar hasta que la imprenta entregue el lote nuevo.
- **`remaining: null` ≠ 0.** La serie de documento no tiene tope y no se agota; confundirlos
  mostraría «serie agotada» en una serie que nunca lo está.
- **Una sola serie activa por destino**, por índice único parcial. Dos correlativos avanzando en
  paralelo son números repetidos.

---

## Lo que sigue

**G4-3 · Motor de impuestos.** IVA por alícuota (general, reducida, adicional, exento, no sujeto)
sobre la misma factura, base imponible, y la trampa de diseño de la etapa: **el IGTF depende del
medio de pago, así que se conoce al COBRAR y no al facturar**. Más la tasa BCV por comprobante, que
es lo que permite expresar en bolívares un negocio que se pacta en dólares.

Después: G4-4 comprobantes (factura, NC/ND, formato legal imprimible) y G4-5 libros de IVA.

**Pendiente de esta etapa:** no hay UI todavía para dar de alta la serie — hoy se carga por API. Va
junto con la pantalla de emisión en G4-4, que es donde el productor la va a necesitar. Y el punto de
partida del lote (`range_from`/`range_to`) hay que tomarlo del lote real de la imprenta cuando el
productor lo tenga a mano.
