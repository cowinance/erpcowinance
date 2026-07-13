# P7 — Notificaciones / entrega proactiva · Cierre de sprint (Fase 1)

**Estado:** ✅ COMPLETO (Fase 1: motor + entrega + feed/badge) · ⏳ Fase 2 diferida (lado-dispositivo) · **Rama:** `main`
**Alcance:** convertir las alertas ya calculadas en **entrega proactiva** — un ledger de
notificaciones por usuario, con **feed in_app + badge** en web y móvil (offline-first), y la
**infraestructura de push** (token, cola de entrega por dispositivo, transporte Expo, procesador)
lista y segura, sin todavía activar la recepción real en el dispositivo.

> Registro histórico del sprint. Cierres previos: [`p2-import-completion.md`](./p2-import-completion.md),
> [`p3-movements-completion.md`](./p3-movements-completion.md), [`p4-agenda-completion.md`](./p4-agenda-completion.md),
> [`p5-capture-parity-completion.md`](./p5-capture-parity-completion.md), [`p6-tasks-completion.md`](./p6-tasks-completion.md).

---

## 1. Objetivo

Tras P4 (agenda) y P6 (tareas), el sistema **calculaba** qué requería atención (alertas,
vencimientos) pero el usuario tenía que **ir a buscarlo**. P7 invierte el flujo: las condiciones
notificables se materializan en un **ledger de notificaciones por usuario** (fuente única de
reglas: el motor de alertas existente), se muestran como **feed + badge** donde el usuario ya
está, y quedan preparadas para **empujarse** al dispositivo. Todo sin duplicar reglas de negocio
y respetando el offline-first del móvil.

Se dividió en dos fases para mantener cada ola **verificable**:
- **Fase 1 (esta):** motor + ledger + cola de entrega + transporte + procesador + feed/badge.
- **Fase 2 (diferida):** activación real en el dispositivo (`expo-notifications`, permisos, token,
  recepción/tap).

## 2. Alcance implementado

- **P7-1 · Motor y ledger** (`modules/notifications`): `NotificationService.dispatch(userId)`
  evalúa las reglas y materializa las alertas notificables abiertas (categorías `health`,
  `reproduction`) como notificaciones **in_app `delivered`** (idempotentes, sin retroactivas) y,
  si hay token activo, encola su entrega push. `feed`, `markRead`, `unreadCount` y
  `refreshUnreadCount` (read-through).
- **P7-2 · Token de dispositivo:** `sync.setPushToken(deviceId, token)` idempotente («un token,
  un device») + `POST /sync/devices/:id/push-token`.
- **P7-3 · Transporte y procesador de push:** tabla `notification_deliveries` (entrega por
  dispositivo, separada de la notificación lógica); `PushTransport` port; `ExpoPushTransport`
  (Expo Push HTTP API, aislamiento por sub-lote, prevalidación); `DisabledPushTransport`;
  `PushProcessor` (claim con RLS worker, envío fuera de transacción, clasificación de tickets,
  backoff, invalidación de token solo ante `DeviceNotRegistered`); habilitación por config
  (`PUSH_ENABLED`).
- **P7-4 · Feed in_app + badge (web + móvil):**
  - **Web** (`/notificaciones`): feed del ledger + marcado individual + deep-link; badge en el
    Sidebar con contador **read-through** (correcto en cualquier página sin abrir el feed).
  - **Móvil** (offline-first, patrón cache-on-sync de la Agenda): capa de datos pura
    (reconciliación del read-set persistido) + pantalla `/notificaciones` + badge en la pestaña
    **Menú** + fila en el Menú, con lectura **local-first** (baja el badge y navega aunque el
    `POST /read` quede pendiente).

## 3. Arquitectura final

```
                 Motor de reglas (fuente única)
                 AlertsService.computeDesired/evaluate
                              │
                    NotificationService.dispatch(userId)
                     │                          │
           notifications (in_app)      notification_deliveries (push, por device)
           status delivered/read        status queued/sent/failed
                     │                          │
        ┌────────────┴───────────┐              │  PushProcessor (claim RLS worker)
     Web  GET /notifications   Móvil            │   prep tx → send() FUERA de tx → results tx
     read-through unread-count  cache-on-sync    │        │
        │  feed + badge          feed + badge    │   ExpoPushTransport ──► Expo Push API
     marcar leída (POST)     marcar leída local  │   (Disabled si PUSH_ENABLED=false)
                              first + reconciliación
```

Invariantes clave:
- **Una sola fuente de reglas:** `dispatch()` reusa el motor de alertas; no re-decide qué es
  notificable en otro lugar.
- **Notificación lógica ≠ entrega por dispositivo:** `notifications` (una por usuario/alerta) vs
  `notification_deliveries` (una por device); permite invalidar un token sin perder el feed.
- **Idempotencia:** índice único `(tenant, user, channel, alert_id)` filtrado; sin duplicados ni
  entregas retroactivas.
- **Offline-first móvil:** el feed y el badge se sirven del último snapshot cacheado; marcar
  leída es local-first y se reconcilia best-effort en el próximo sync, sin abortar el sync CRDT.

## 4. Decisiones arquitectónicas importantes

- **in_app `delivered`, no `queued`** (P7-1): el feed es entrega directa; `queued` es solo del
  canal push.
- **Tabla `notification_deliveries` separada** (P7-3): una fila por dispositivo, con
  `token_snapshot` para invalidación segura; RLS bespoke con excepción `app.job_scope='push_worker'`.
- **`PushError` como enum cerrado + `providerCode`** y `PushTransportRequestError` (P7-3): la
  clasificación permanente/transitoria es del dominio, no del string del proveedor.
- **Aislamiento por sub-lote en el transporte** (P7-3): un sub-lote fallido no pierde los éxitos
  de los demás; misma semántica sin importar la posición.
- **`DisabledPushTransport` que lanza (no NoOp)** + config inyectada (P7-3): el boot falla ante
  `PUSH_ENABLED` malformado; sin fallback silencioso.
- **Unread-count read-through** (P7-4.b): el badge dispara `dispatch()` antes de contar → correcto
  en cualquier página sin descargar el feed (como `/alerts/kpis` con las alertas).
- **Read-set persistido y reconciliado offline** (P7-4.c): una notificación se ve leída si el
  servidor lo dice **o** su id está en el read-set pendiente; se poda por confirmación, 404 o
  estado `read` del servidor; un snapshot nulo **nunca** sustituye el cache por `[]`.
- **`persistMeta` como única función de mutación** (P7-4.c): evita read-modify-write sobre
  snapshots obsoletos ante concurrencia (sync / pantalla / taps rápidos).
- **Fuente única de contador y orden** (P7-4): `reconcileView`/`unreadNotifications`; la UI no
  reordena ni recalcula.
- **Helpers puros compartidos** (P7-4.c): `relativeTime` y `notificationHref` sin dependencias de
  RN/Expo → entran al gate de Vitest; `AgendaToday` migró al helper compartido.

## 5. Criterios de aceptación cumplidos

- Una condición notificable abierta genera **exactamente una** notificación in_app por usuario,
  idempotente, sin retroactivas.
- El badge es correcto en cualquier página/pantalla sin abrir el feed (read-through en web;
  cache-on-sync + reconciliación en móvil).
- Marcar leída baja el badge al instante; en móvil funciona **offline** y preserva la intención
  para el próximo sync; un fallo de red no revierte el estado leído.
- Deep-link cerrado (animal→ficha, task→tareas) por mapa fijo, nunca derivado de datos libres.
- El push está **listo y seguro** (cola por device, transporte con aislamiento, procesador con
  backoff e invalidación de token) pero **inactivo** hasta la Fase 2 (`PUSH_ENABLED=false` →
  `DisabledPushTransport`).
- Ningún fallo del cache/entrega de notificaciones aborta el sync CRDT principal.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **349 tests** en verde (incl. 22 de reconciliación móvil + 8 helpers puros) |
| Ciclos de dependencia (madge) | **0** |
| Playwright E2E (web) | `11-notificaciones` (badge read-through, feed, marcar leída, deep-link, tenant vacío) |
| Typechecks | API, web, móvil, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |
| Verificación push | tests de `ExpoPushTransport` (sub-lotes/prevalidación) + `PushProcessor` (claim/backoff/invalidación) |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **Fase 2 · lado-dispositivo:** `expo-notifications` — permiso del SO, registro real del token
  (`getExpoPushTokenAsync` → `POST /sync/devices/:id/push-token`, endpoint ya existe), handler de
  recepción y de **tap** (→ deep-link), y el **sweep** del `PushProcessor` en runtime real.
- **Receipts de Expo** (segunda pasada tras los tickets) para confirmar entrega y detectar
  `DeviceNotRegistered` diferidos.
- **Preferencias de notificación** por usuario/categoría/canal (silenciar, horarios).
- **Más categorías notificables** (hoy `health`, `reproduction`) y agrupación/resumen.
- **Estado de refresco explícito** en la pantalla móvil (hoy se infiere por la antigüedad del
  snapshot).

## 8. Estado del roadmap

**P7 Fase 1 → COMPLETO.** El motor, el ledger, la cola de entrega, el transporte, el procesador
y el **feed in_app + badge en web y móvil** están terminados, verificados y estables en `main`,
con una única fuente de reglas, convergencia web↔móvil y offline-first en el móvil. El push está
cableado de forma segura pero **inactivo** por configuración.

**Siguiente fase: P7 Fase 2 (lado-dispositivo) o el próximo vertical, por definir.** Mismo método:
análisis previo aprobado antes de código, olas pequeñas y revisables, verificación completa y un
commit por ola.
