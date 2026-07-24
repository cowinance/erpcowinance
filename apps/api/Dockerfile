# syntax=docker/dockerfile:1
#
# Imagen de api-core. Se construye desde la RAÍZ del monorepo (el contexto necesita `packages/`
# y el `package-lock.json` compartido):
#
#   docker build -f apps/api/Dockerfile -t cowinance-api .

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Las fuentes de los paquetes ANTES de instalar: npm corre el `prepare` de cada workspace local
# al enlazarlo —lo hace incluso con `--ignore-scripts`— y ese `prepare` es justamente el que
# compila su `dist/` (que está gitignoreado). Sin las fuentes presentes, `npm ci` falla.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
COPY apps/api ./apps/api

RUN npm ci && npm run build -w @cowinance/api

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# Los paquetes YA COMPILADOS (incluye packages/db: el DDL canónico y las migraciones, que el
# arranque lee del filesystem vía `resolveDbPath`).
COPY --from=build /app/packages ./packages

# Se le quita el `prepare` a los paquetes locales antes de instalar. Ese script compila con
# `tsc`, que es una devDependency y acá no existe — y npm lo corre igual al enlazar un workspace,
# aun con `--ignore-scripts`. El `dist/` ya viene del stage de build, así que no hay nada que
# compilar: sacar el hook es decir exactamente eso.
RUN node -e "const fs=require('fs'); for (const p of ['domain','sync-core','design-tokens']) { const f='packages/'+p+'/package.json'; const j=JSON.parse(fs.readFileSync(f,'utf8')); delete j.scripts.prepare; fs.writeFileSync(f, JSON.stringify(j,null,2)); }" \
 && npm ci --omit=dev --workspace @cowinance/api --include-workspace-root \
 && npm cache clean --force \
 # `COPY` preserva los permisos del host, y ahí `cowinance_schema.sql` está en 0600: el proceso
 # corre como `node`, no como root, y el arranque moría con EACCES al leer el DDL. Se normaliza
 # a "legible por todos" acá, en vez de depender de cómo estén los permisos en cada máquina.
 && chmod -R a+rX packages

COPY --from=build /app/apps/api/dist ./apps/api/dist

# Sin root: `node` (uid 1000) ya existe en la imagen oficial.
USER node

EXPOSE 3001
# Liveness desde el propio contenedor. `readyz` NO va acá a propósito: si la base se cae, el
# contenedor no tiene que reiniciarse en loop — sacarlo de la rotación es decisión del
# orquestador, con la sonda de readiness.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/v1/healthz > /dev/null || exit 1

CMD ["node", "apps/api/dist/main.js"]
