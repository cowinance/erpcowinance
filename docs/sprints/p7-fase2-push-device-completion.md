# P7 — Notificaciones · Fase 2 (lado-dispositivo) · Cierre de sprint

**Estado:** ✅ IMPLEMENTADA (todo el código en `main`) · ⏳ INACTIVA por configuración · **Rama:** `main`
**Alcance:** activar la recepción de push en el móvil — permiso contextual, registro y
reconciliación del token Expo, recepción en foreground, tap y arranque en frío con deep-link,
y rotación de token — sobre la infraestructura de Fase 1. El envío real sigue **apagado** por
`PUSH_ENABLED` y la entrega end-to-end requiere configuración de plataforma (ver §7).

> Registro histórico del sprint. Cierre de la Fase 1:
> [`p7-notifications-completion.md`](./p7-notifications-completion.md). Contrato del payload:
> [`../reference/push-payload-contract.md`](../reference/push-payload-contract.md).

---

## 1. Objetivo

La Fase 1 dejó el ledger de notificaciones, el feed in_app + badge (web y móvil) y toda la
tubería de push (token backend, cola de entrega por dispositivo, transporte Expo, procesador)
**lista pero inactiva**. La Fase 2 conecta el último tramo: que el **dispositivo** pida permiso,
obtenga y sincronice su token Expo, reciba las notificaciones y navegue al recurso correcto al
tocarlas — sin duplicar reglas ni romper el offline-first.

## 2. Alcance implementado

Tres sub-olas, cada una con su commit y gate en verde:

- **F2.a — Registro de token** (móvil): dependencia `expo-notifications@57` + plugin; capa pura de
  orquestación del registro (permiso, canal, token) con estados tipados; envoltorio nativo;
  acción **contextual** «Activar notificaciones» en el Menú (el prompt del SO nunca se dispara en
  boot ni al abrir el feed).
- **F2.c — Contrato del payload** (API): contrato mínimo y **versionado** del `data` del push
  (`{ v, notificationId, relatedType, relatedId }`) + enriquecimiento del `PushProcessor`, con
  test de contrato. Define lo que consume el deep-link, por eso va antes de F2.b.
- **F2.b — Recepción + navegación** (móvil): handler de foreground, listeners de recepción/tap,
  arranque en frío, rotación de token, reconciliación en boot y wiring raíz; resolver de destino
  único y puro con fallback centralizado.

## 3. Arquitectura final

```
  Menú «Activar»            Boot (con device)           Push entrante
       │                          │                    ┌──────┴───────┐
  activatePush              reconcilePush          recibido        tap / cold start
  (permiso PROMPT)          (permiso CHECK-ONLY)      │                 │
       └──────────┬───────────────┘           scheduleNotifications  resolvePushDestination(data)
                  │                              Refresh (anti-ráfaga)  (valida contrato v1,
       registerPushToken (PURO)                        │                 reusa notificationHref,
       canal → permiso → getExpoPushToken               refreshNotifications  fallback /notificaciones)
       → syncPushToken (POST push-token)                                    │
                  │                                                    router.navigate (una vez)
       addPushTokenListener (rotación) ── señal ──► reconcilePush
```

Invariantes clave:
- **Orquestación pura e inyectable:** `registerPushToken`/`resolvePushDestination` no tocan el SO
  → entran al gate de Vitest con fakes. Lo nativo se aísla en `native.ts`.
- **Permiso contextual:** el prompt del SO solo por acción explícita del usuario.
- **El token nativo NO se envía:** `addPushTokenListener` (APNs/FCM) es solo una **señal** para
  re-obtener y sincronizar el token **Expo**.
- **Fuente de verdad reconciliable:** `lastPushToken` local es optimización; en boot se reconcilia
  contra el servidor (permiso check-only, sin prompt).
- **Destino centralizado:** un único resolver valida el contrato y **siempre** cae a
  `/notificaciones`; no se navega dos veces entre cold start y listener (dedup por identifier).
- **Anti-ráfaga:** los pushes en foreground coalescen en un solo refresh (debounce trailing, el
  mismo patrón que `scheduleSync`).

## 4. Decisiones arquitectónicas importantes

- **D0 — activación segura:** `projectId` se lee de `Constants.expoConfig.extra.eas.projectId`; si
  falta o el flag está off, no se registra (estados `missing-project-id`/`disabled`), sin fallo
  silencioso — hay estado tipado + log de desarrollo no sensible.
- **Estados tipados:** `idle | disabled | missing-project-id | permission-denied | registered |
  error`, sin exponer el token.
- **Contrato versionado (F2.c):** camelCase, mínimo; cualquier cambio de forma sube
  `PUSH_DATA_VERSION` y el cliente degrada al fallback si no reconoce la versión.
- **`related_*` desde `alerts`:** esas columnas no existen en `notifications`; se cargan por
  `LEFT JOIN alerts` (misma fuente que el feed) — bug atrapado por el gate y corregido.
- **Rotación → re-fetch Expo token:** nunca se envía el token nativo directo; la suscripción se
  desmonta en el cleanup.

## 5. Criterios de aceptación cumplidos

- El usuario activa las notificaciones con una acción explícita; el token Expo se registra y
  sincroniza (idempotente local + reconciliable en servidor).
- Un push en foreground refresca feed y badge in_app (con anti-ráfaga).
- El tap y el cold start navegan **una sola vez** al destino resuelto; payload inválido/otra
  versión/tipo no soportado → `/notificaciones`.
- La rotación del token se refleja re-obteniendo el token Expo; las suscripciones se liberan.
- Sin `projectId`/con flag off, no se prompta ni se registra; estados observables.
- Ningún camino nuevo altera el sync CRDT ni el offline-first.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **373 tests** en verde (registro 12, resolver 8, contrato 4, + resto) |
| Ciclos de dependencia (madge) | **0** |
| Typechecks | API, móvil, web, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |
| Entrega end-to-end en dispositivo | **no automatizable aquí** → plan de prueba manual documentado |

## 7. Pendiente para activar en producción (fuera de esta fase)

Requiere plataforma/credenciales que no viven en el repo:

- **Proyecto EAS** con `extra.eas.projectId` en `app.json`.
- **Credenciales push** (APNs para iOS, FCM para Android) configuradas en EAS.
- **Development/production build** (Expo Go no soporta push remoto desde SDK 53).
- **`PUSH_ENABLED=true`** en la API (hoy `DisabledPushTransport`).
- Ejecutar el **plan de prueba manual** de
  [`../reference/push-payload-contract.md`](../reference/push-payload-contract.md).

Diferido consciente: receipts de Expo, preferencias por categoría/canal, badge del ícono del SO.

## 8. Estado del roadmap

**P7 (Fase 1 + Fase 2) → IMPLEMENTADO.** Las notificaciones proactivas están completas de
extremo a extremo en código, verificadas por typecheck/tests puros/arquitectura y estables en
`main`; el push queda **inactivo por configuración** a la espera de la activación de plataforma.

**Siguiente fase: próximo vertical del roadmap, por definir.** Mismo método: análisis previo
aprobado antes de código, olas pequeñas y revisables, verificación completa y un commit por ola.
