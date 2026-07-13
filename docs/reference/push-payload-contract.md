# Contrato del payload push (`data`)

**Estado:** vigente · **Versión:** `1` · **Fuente:** [`push-message.contract.ts`](../../apps/api/src/modules/notifications/push-message.contract.ts)

Contrato **mínimo y versionado** del objeto `data` que el backend adjunta a cada notificación
push (Expo). Su único propósito es que el **cliente** resuelva a dónde navegar al tocar la
notificación. El backend **no** emite rutas ni lógica de navegación.

## Forma

```jsonc
{
  "v": 1,                    // versión del contrato (número). El cliente exige v === 1.
  "notificationId": "…",     // id de la notificación in_app (siempre presente)
  "relatedType": "animal" | "task" | null,
  "relatedId": "…" | null    // id del recurso relacionado, o null
}
```

- **Convención:** camelCase (coherente con `notificationId`, ya existente en el payload). El
  snake_case (`related_type`/`related_id`) es solo de la DB/feed; no aparece en el push.
- **Mínimo:** sin campos de más (título/cuerpo viajan en el mensaje push, no en `data`).
- **Origen de `relatedType`/`relatedId`:** las alertas (`alerts`), vía `notifications.alert_id`
  (`LEFT JOIN alerts`), igual que el feed. Pueden ser `null` (notificación sin recurso).

## Quién valida qué

| Lado | Responsabilidad |
|---|---|
| **Backend** (`buildPushMessageData`) | Emitir la forma correcta y null-safe; fijar `v`. Nada de rutas. |
| **Cliente** (móvil, F2.b) | Validar el payload (versión + campos), resolver el destino con `notificationHref`, y **caer a `/notificaciones`** si el payload es inválido, incompleto, de otra versión o de un `relatedType` no soportado. |

El mapeo de destino es responsabilidad exclusiva del cliente
([`notification-nav.ts`](../../apps/mobile/src/sync/notification-nav.ts)): `animal` + id →
`/animal/:id`; `task` → `/tareas`; cualquier otro caso → `/notificaciones`.

## Versionado

Cualquier cambio de forma (renombrar, quitar o resignificar un campo) **obliga a subir
`PUSH_DATA_VERSION`**. El cliente que reciba una versión que no reconoce debe degradar con
seguridad al fallback `/notificaciones`, nunca romper.

## Verificación

### Automatizada (gate `audit:arch`)

- **Backend:** test de contrato ([`push-message.contract.test.ts`](../../apps/api/src/modules/notifications/push-message.contract.test.ts))
  — forma exacta, `v === 1`, null-safe; regresión de `push.processor.integration`.
- **Cliente:** resolver de destino ([`deep-link.test.ts`](../../apps/mobile/src/push/deep-link.test.ts))
  — animal/task/versión≠1/incompleto/tipo no soportado/no-objeto → fallback; registro de token
  ([`registration.test.ts`](../../apps/mobile/src/push/registration.test.ts)) — estados, orden
  canal→permiso→token, idempotencia.
- Typecheck (api + móvil) y 0 ciclos.

> Lo automatizable acá es la **forma del contrato y la lógica pura**. La entrega push real NO es
> verificable en este entorno (no hay dev build, proyecto EAS, credenciales ni dispositivo).

### Manual (pendiente — end-to-end en dispositivo real)

Requisitos: **development build** (no Expo Go, SDK 53+), **proyecto EAS** con
`extra.eas.projectId` en `app.json`, **credenciales push** (APNs/FCM) configuradas en EAS,
**dispositivo físico** compatible, y `PUSH_ENABLED=true` en la API.

1. **Permiso + token (F2.a):** en el Menú, «Activar notificaciones» → se acepta el prompt del SO →
   estado `registered`; verificar en el server que `sync_devices.push_token` quedó seteado.
2. **Sin projectId / flag off:** confirmar estados `missing-project-id` y `disabled` (no se prompta
   ni se registra).
3. **Recepción en foreground (F2.b):** generar una condición notificable (p. ej. tratamiento con
   retiro) y disparar el envío del `PushProcessor` → llega la notificación con banner; el feed
   in_app y el badge se refrescan (anti-ráfaga: varias seguidas colapsan en un refresh).
4. **Tap con app abierta:** tocar la notificación → navega al destino resuelto (animal→ficha,
   task→/tareas) según el `data`; payload inválido/otra versión → `/notificaciones`.
5. **Cold start:** con la app cerrada, tocar la notificación → abre y navega UNA sola vez (sin
   doble navegación entre `getLastNotificationResponseAsync` y el listener).
6. **Rotación de token:** forzar rotación → se re-obtiene el token Expo (no se envía el nativo) y se
   sincroniza con el server; al desmontar, la suscripción se libera.
7. **Reconciliación en boot:** con permiso ya concedido, reiniciar la app → el token se reconcilia
   con el server sin volver a pedir permiso.

Diferido (fuera de Fase 2): receipts de Expo, preferencias por categoría/canal, badge del ícono
del SO.
