# Modo Manga — mejora a estación de captura rápida (COMPLETO 6/6)

De una pantalla de solo-pesaje a una **estación de trabajo rápida en campo**: identificar →
registrar acción → guardar → siguiente. Botones/tipografía grandes, foco automático, Enter-avanza,
compatible con lector RFID/teclado, alto contraste. Web `apps/web/src/app/manga/` (fullscreen
negro); móvil `apps/mobile/src/app/manga.tsx` (offline vía SyncContext). **Reutiliza servicios
centrales, sin inserts manuales.**

## Etapas

### E1 — Tarjeta robusta + lookup enriquecido (`c91df66`)
`herd.lookup` devuelve la tarjeta completa en UNA query: identidad + ubicación (lote/potrero) +
último peso/CC/GDP + días desde pesaje + preñez/parto + retiro activo + caso abierto. Resuelve por
cualquier identificador. Web: `AnimalCard` grande/legible + fila de alertas rápidas (máx 3).

### E2 — Sesión de trabajo (`7bd82ef`)
Ciclo setup → captura → resumen. Nombre/lote objetivo/inicio, barra siempre visible (conexión +
contadores reg/err + salir), últimos registros, resumen final. Estado `records[]`.

### E3 — Validaciones fuertes de peso (`bf0c50d`)
Regla PURA `validateWeighing` en `packages/domain/production` (única, backend errores duros + web
warning/confirm de cambio extremo ≥40% o ≥4 kg/día). **apps/web pasa a depender de
@cowinance/domain** (dist gitignore → rebuild por consumidor).

### E4 — Modos simples (`ef2fcd0`)
Selector de 7 modos (Pesaje default). `MangaCapture.tsx`: Revisión/Nota (events + plantillas),
Tratamiento (/treatments), Vacunación (/vaccinations), Movimiento (/movements), Reproducción
(/heats|services + /pregnancy-diagnoses). Cada uno reusa su servicio central + Idempotency-Key.

### E5 — Alertas accionables + feedback + anti-rebote (`a58688c`)
Alertas de la tarjeta con `mode` → botón que salta a ese modo. Anti-rebote del lector (mismo id
re-escaneado <1500 ms ignorado + guard de concurrencia). Vibración háptica, guard de doble-submit,
recuperación de foco.

### E6 — Deshacer + offline/sync visual + resumen export (`03008e5`)
Deshacer último pesaje: `registerEvent` guarda `weighing_id`, `herd.deleteWeighing` soft-borra
pesada + evento (timeline/event_count filtran `deleted_at IS NULL`). Solo pesadas. Offline
(web REST-directo): banner + contador «pend»; pesaje que falla offline queda PENDIENTE y se
reenvía al reconectar (flushPending). Resumen: breakdown por acción + Exportar CSV.

## Reutilización (criterios técnicos cumplidos)
- Pesajes → evento/timeline (`POST /animals/:id/events`, Idempotency-Key).
- Movimientos → servicio central (`POST /movements`); NUNCA update directo de current_lot_id.
- Tratamientos/vacunas → servicios de sanidad (`/treatments`, `/vaccinations`).
- Reproducción → servicios de repro (`/heats`, `/services`, `/pregnancy-diagnoses`).
- Idempotencia en todos los guardados; sin pérdida de datos offline (pendiente + reenvío).

## Estado
- **herd 96 tests verdes** (incl. manga-lookup + deshacer); dominio +9 (validateWeighing).
- Backend nuevo mínimo: lookup enriquecido, `weighing_id` en payload, `DELETE /weighings/:id`.

## Diferido / móvil
El móvil (`manga.tsx`) mantiene su captura offline de pesaje (SyncContext). Paridad de los modos
nuevos (tratamiento/vacuna/movimiento/repro) y de la sesión/alertas en móvil = follow-up (Expo
v57, leer docs antes). La cola offline real es del móvil; la web hace REST directo con pendiente+reenvío.
