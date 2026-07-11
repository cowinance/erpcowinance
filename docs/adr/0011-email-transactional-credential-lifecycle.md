# 0011 — Email transaccional y ciclo de vida de credenciales (verificación + reset)

- **Estado:** aceptado
- **Fecha:** Fase Producto, sprint P1 (Onboarding SaaS), P1.2
- **Contexto relacionado:** [[0005-event-bus-outbox]] (patrón puerto/adaptador que reutiliza), [[0010-tenant-self-service-provisioning]] (cierra la decisión #5, `email_verified_at` diferida a P1.2); `docs/product/product-roadmap-2026.md` §P1

## Contexto

Tras P1.1, una finca se registra sola (`POST /register`) y entra al instante, pero la cuenta no tiene
ciclo de vida de credencial: el email nunca se verifica y no hay forma de recuperar una contraseña
olvidada. P1.1 dejó preparada la columna `users.email_verified_at` (NULL) y difirió explícitamente a
P1.2 el envío/verificación y el reset (ADR-0010 §5 y "fuera de alcance").

Restricción arquitectónica heredada y a preservar: **`identity` = usuarios, organizaciones, estado de
identidad; `auth` = autenticación, sesiones y tokens; `infra` = proveedores externos.** El envío de
email es un servicio externo; verificación y reset son ciclo de vida de la cuenta/credencial (dato de
`users`, plano de identidad), no de sesión.

## Decisión

Implementar email transaccional, verificación de email y reset de contraseña reutilizando el patrón
puerto/adaptador ya establecido por ADR-0005, sin romper la separación de capas. Seis decisiones
concretas (todas aprobadas explícitamente antes de implementar):

### A. Almacenamiento de tokens: tabla única `email_action_tokens`
Una tabla con columna `purpose ∈ {verify_email, password_reset}` en vez de dos tablas. Los dos flujos
son **el mismo mecanismo** (token opaco single-use con expiración) con distinto propósito y TTL; dos
tablas duplicarían esquema, índices y lógica de expiración — la regla viviría en dos lugares (viola la
regla permanente #2). El cruce de propósitos se elimina validando `purpose` al consumir. La tabla es
**sin RLS** (plano de identidad, como `users` y `auth_refresh_tokens`): se consume en flujos `@Public`
sin contexto de tenant, resuelta por `user_id` embebido en la fila.

### B. Se guarda el HASH del token, no el token en claro
El token en claro viaja **solo** en el email; en DB se guarda `sha256(token)`. Un dump de la base no
da tokens usables. Un secreto aleatorio de 256 bits (`randomBytes(32)`) no necesita un KDF caro tipo
scrypt (eso es para contraseñas de baja entropía) — SHA-256 alcanza y es determinista para buscar por
hash. Coherente con que `passwords.ts` nunca guarda la contraseña en claro.

### C. Política de login con email no verificado: permitir (soft)
Login funciona sin verificar. El estado `email_verified_at` es informativo y habilita **gating de
acciones sensibles en el futuro** (invitaciones, facturación) sin bloquear el onboarding. Alineado con
la intención de producto ya fijada en ADR-0010 §5 (reducir fricción para design partners). `auth` no
cambia su lógica de credenciales.

### D. Puerto `EmailSender` con adaptador de dev; proveedor real diferido
Puerto `EMAIL_SENDER` en `apps/api/src/application/ports/` (mismo molde que `EventPublisher`): los
servicios de `identity` dependen SOLO de la interfaz. Único adaptador en P1.2: `LogEmailSender`
(`infra/email/`), que imprime el email al log — habilita e2e sin proveedor ni secretos. El adaptador se
elige por `EMAIL_PROVIDER` (default `log`); SMTP/SES/Resend serán adaptadores nuevos + un `case`, sin
tocar `identity` — igual que Kafka reemplazaría el transporte de eventos sin tocar `EventPublisher`.

### E. Disparo del email: llamada directa al puerto (no por evento/outbox)
`identity` llama `EmailSender.send(...)` directamente, no vía un evento de dominio por el outbox. El
**reset es intrínsecamente síncrono** (petición del usuario, respuesta inmediata) y no puede ser un
evento; usar eventos solo para verificación crearía asimetría. La atomicidad que aporta el outbox es
para *persistir el token* — que ya se logra escribiéndolo en su propia sentencia; la entrega del email
es externa/best-effort y su ruta de recuperación es `resend-verification`. YAGNI: no se introduce el
primer evento con efecto externo hasta que haya más reacciones a "usuario registrado".

### F. Revocación de sesiones en el reset: `identity` invoca `auth`
Cambiar la contraseña debe invalidar las sesiones vivas. `password_hash` es dato de identidad, pero las
sesiones (`auth_refresh_tokens`) son de `auth`. Para no filtrar el almacenamiento de sesiones a
identity, `auth` expone `revokeAllSessions(userId)` y `identity` lo invoca. Es una dependencia dirigida
`identity → auth` **solo para invalidar sesiones** (identity sigue sin emitir tokens): no invierte la
relación ni crea ciclo (`madge` 0 ciclos verificado).

### Flujos
- **Verificación:** `register` → emite token `verify_email` y envía email **best-effort tras el commit**
  (si el envío falla, el alta queda firme; se recupera con `resend-verification`) → `POST /verify-email`
  consume el token y setea `email_verified_at`.
- **Reset:** `POST /forgot-password` (respuesta **constante** `{ok:true}`, anti-enumeración; emite token
  `password_reset` solo si el usuario existe y está activo) → `POST /reset-password` valida la contraseña
  **antes** de consumir el token (una débil no lo quema), setea `password_hash` y revoca todas las
  sesiones.

### Garantías del token (repositorio `EmailActionTokenService`, en `identity`)
- **Single-use:** consumir marca `consumed_at` en el mismo `UPDATE ... WHERE consumed_at IS NULL ...
  RETURNING` que valida (atómico).
- **Expiración:** el consumo exige `expires_at > now()` (verify 24 h, reset 1 h).
- **Un token vivo por (user, purpose):** emitir supersede los previos.
- **Purpose no intercambiable:** un token de verificación no consume como reset y viceversa.

## Consecuencias

- **Positivo:** ciclo de vida de credencial completo (verificar + recuperar) sin romper la separación
  identity/auth/infra; puerto de email reemplazable por un proveedor real sin tocar `identity`;
  anti-enumeración en las superficies públicas nuevas; reset invalida sesiones (seguridad). Cierra la
  deuda que ADR-0010 dejó abierta (`email_verified_at`).
- **Costo:** una tabla `email_action_tokens` (DDL idempotente en `db.service.SYNC_MIGRATION`), un
  adaptador de dev, y la dependencia dirigida `identity → auth` para revocar sesiones.
- **Nuevo puerto de aplicación explícito** (`EmailSender`) — segundo tras `EventPublisher`, confirma
  `application/ports/` como el lugar de los puertos de salida.

## Alternativas consideradas

- **Dos tablas de tokens** (verify / reset). Descartada (A): duplica la misma regla.
- **Token en claro en DB.** Descartada (B): un dump filtraría tokens usables.
- **Bloquear login hasta verificar (hard).** Descartada (C): mata el onboarding de 5 minutos; si el
  email no llega, el usuario queda afuera. Contradice ADR-0010 §5.
- **Email por evento `UserRegistered` + outbox.** Descartada para P1.2 (E): asimetría con el reset
  (síncrono) y machinery innecesaria; queda como evolución natural si aparecen más reacciones.
- **Reset escribiendo `auth_refresh_tokens` desde identity.** Descartada (F): filtra el almacenamiento
  de sesiones a identity; el método `revokeAllSessions` mantiene la frontera.

## Fuera de alcance (futuro, no P1.2)

- Proveedor de email real (SMTP/SES/Resend) — solo el adaptador `log` de dev.
- Plantillas/HTML del email (hoy texto plano).
- Rate limiting y endurecimiento anti-abuso de las superficies públicas (`register`/`forgot`/`resend`).
- Gating de acciones sensibles por `email_verified` (el estado existe; su enforcement es futuro).
- Verificación por cambio de email de un usuario ya existente; MFA.
