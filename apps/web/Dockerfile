# syntax=docker/dockerfile:1
#
# Imagen de la web (Next.js). Se construye desde la RAÍZ del monorepo:
#
#   docker build -f apps/web/Dockerfile -t cowinance-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.ejemplo.com/v1 .
#
# OJO con `NEXT_PUBLIC_API_URL`: Next la INLINEA en el bundle del navegador durante el build, no
# la lee en runtime. O sea que la URL de la API queda horneada en la imagen: una imagen por
# entorno. Ponerla solo en el `environment` del compose no tiene efecto sobre el código cliente.

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:3001/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

# Las fuentes de los paquetes ANTES de instalar: npm corre el `prepare` de cada workspace local
# al enlazarlo (compila su `dist/`, que está gitignoreado) incluso con `--ignore-scripts`.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages ./packages
COPY apps/web ./apps/web

RUN npm ci && npm run build -w @cowinance/web

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: 'standalone'` (next.config.ts) deja acá un servidor con SOLO las dependencias que el
# build rastreó — nada del node_modules del monorepo. Los estáticos van aparte porque el
# standalone no los incluye.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# (no hay `apps/web/public`: la app no sirve estáticos propios fuera de los que emite Next)

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login > /dev/null || exit 1

CMD ["node", "apps/web/server.js"]
