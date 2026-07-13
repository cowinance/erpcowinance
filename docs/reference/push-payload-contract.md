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

- **Automatizada:** test de contrato ([`push-message.contract.test.ts`](../../apps/api/src/modules/notifications/push-message.contract.test.ts))
  — forma exacta, `v === 1`, null-safe; regresión de `push.processor.integration`.
- **Manual (pendiente, no automatizable en este entorno):** la entrega y el tap end-to-end
  requieren development build + proyecto EAS + credenciales push + dispositivo compatible. El
  plan de prueba manual completo se consolida con F2.b (recepción → tap → deep-link).
