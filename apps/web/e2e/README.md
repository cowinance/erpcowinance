# E2E web — recorrido crítico de onboarding (P1.3.7)

Suite Playwright que protege los cinco flujos de onboarding de punta a punta. **No**
automatiza toda la app; sólo el camino crítico.

## Escenarios

1. `01-register-autologin` — registro + auto-login → dashboard vacío (nombre real, finca, banner).
2. `02-register-fallback` — registro OK + auto-login que falla → fallback "Tu cuenta fue creada" → login real.
3. `03-verify-email` — verificación por token, reuso inválido (single-use), el banner desaparece.
4. `04-forgot-reset` — recuperación + reset, anti-enumeración, token de un solo uso, contraseña vieja falla / nueva entra.
5. `05-first-animal` — tenant vacío → "Cargar primer animal" → dashboard operativo.

## Cómo se ejecuta

```bash
# 1) Una sola vez: navegador de Playwright
npx playwright install chromium          # (o --with-deps en CI Linux)

# 2) Correr la suite (compila el API y levanta instancias aisladas)
npm run e2e:web                          # desde la raíz: build API + playwright test

# equivalente manual:
npm run build -w @cowinance/api
npm run e2e --workspace @cowinance/web   # apps/web: playwright test
npm run e2e:ui  --workspace @cowinance/web   # modo UI (debug)
```

## Infraestructura (`e2e/global-setup.ts`)

- Levanta **instancias aisladas**, no depende de servidores iniciados a mano:
  - **API**: `apps/api/dist/main.js` con `SEED_DEMO=off`, `EMAIL_PROVIDER=log`, `JWT_SECRET` de test,
    `cwd` en un temporal fuera del repo (la `.data` de PGlite cae ahí) y **stdout → `api.log`**.
  - **Web**: `next dev` con `NEXT_PUBLIC_API_URL` apuntando al API de test.
- **Puertos**: web `3210`, API `3211` (aislados de dev 3000/3001). `global-setup` verifica que estén
  **libres** y aborta con un mensaje claro si no — **no mata procesos ajenos**. Para cambiarlos: `e2e/env.ts`.
- **Teardown** (devuelto por `global-setup`): mata ambos procesos por grupo (`detached`) y borra el
  temporal, **incluso si un test falla**.

### Variables / requisitos
- Requiere el API compilado (`npm run build -w @cowinance/api`); `e2e:web` lo hace por vos.
- `npx playwright install chromium` (CI Linux: `--with-deps`).
- No hay variables obligatorias para el desarrollador: puertos y rutas salen de `e2e/env.ts`.

## DB, logs y temporales — dónde se crean y limpian
- Todo lo temporal vive en `os.tmpdir()/cowinance-web-e2e/` (**fuera del repo**): la `.data` de PGlite
  y `api.log`. Se **borra** en el teardown.
- Artefactos de Playwright (`test-results/`, `playwright-report/`) están en `.gitignore`.

## Lectura de emails (adaptador `log`)
- **No** hay buzón ni endpoint de dev. El helper `waitForActionToken` lee `api.log` y localiza el email
  por **destinatario + propósito** (`/verify-email` vs `/reset-password`) y **posición posterior** al inicio
  del escenario (`logSize()`), tomando el más reciente. Los tokens quedan **sólo en memoria**; nunca se
  imprimen ni aparecen en mensajes de error o nombres de test.

## Ejecución SERIAL (por qué)
- `workers: 1`, `fullyParallel: false`: los cinco escenarios comparten **una** instancia de API, **un**
  `api.log` y **una** base PGlite. No se habilita paralelismo hasta tener aislamiento por worker
  (DB/log/puertos por worker). `retries: 0`: un flake debe verse, no enmascararse.

## Datos y aislamiento
- Cada test genera email/nombre **únicos** (`uniqueUser`), sin depender de los tenants demo.
- Sin orden asumido entre tests; sin compartir tokens entre escenarios.

## CI (pendiente de cablear en un paso posterior)
El comando queda listo: `npx playwright install --with-deps chromium && npm run e2e:web`.
`audit:arch` **no** descarga navegadores ni arranca Playwright — el gate E2E es explícito y separado.
