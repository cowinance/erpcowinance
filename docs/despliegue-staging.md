# Staging: un servidor para probar la app móvil de verdad

**Para qué.** La app móvil nunca corrió en un teléfono. Todo lo que está verificado se verificó en
el navegador o con tests, y eso no alcanza para la cámara, las fotos ni el ciclo de captura sin
señal. Este entorno existe para cerrar esa brecha: un servidor con HTTPS al que el teléfono pueda
llegar desde cualquier lado, con las mismas imágenes que irían a producción.

**Por qué no alcanza con la red local.** Se puede apuntar el teléfono a la laptop por WiFi y es más
rápido de montar, pero solo funciona en casa, con la laptop prendida, y no prueba nada de lo que
rompe en producción: TLS, un proxy adelante, almacenamiento de objetos, correo real.

---

## Lo que hay que tener antes

| | Por qué |
|---|---|
| Un servidor con Docker | 2 GB de RAM. Ver la nota de abajo sobre el tamaño. |
| Dos subdominios apuntando a él | `staging.…` para la web y `api.staging.…` para el teléfono. **El DNS tiene que resolver antes de levantar**: Caddy valida el dominio al arrancar. |
| Puertos 80 y 443 abiertos | El 80 no es opcional: es por donde se valida el dominio para emitir el certificado. |
| Un bucket de objetos privado | Sin esto las fotos del animal se pierden en cada despliegue. |
| Un SMTP | Sin esto no llega la verificación de email ni el reset de contraseña. |

### Sobre el tamaño del servidor

Corren cuatro procesos: PostgreSQL, la API, el servidor de Next y Caddy. Sumados rondan los
600-800 MB en reposo, más el sistema operativo.

**1 GB no alcanza.** Entra justo y se queda sin aire ante cualquier pico — un sync grande, varias
fotos, el arranque simultáneo de todo. En AWS Lightsail eso es el plan de **2 GB (12 USD al mes)**;
el de 1 GB (7 USD) va a dar problemas y el de 0,5 GB directamente no arranca.

Las imágenes se BAJAN ya construidas (`--no-build`), así que el servidor no necesita memoria para
compilar. Construir ahí además significaría correr algo que nunca pasó por CI.

### Si es AWS Lightsail

Tres cosas que no son evidentes y se pagan caro:

- **Asignar una IP estática** (pestaña Redes). Por defecto la IP cambia al detener y arrancar la
  instancia, y el DNS queda apuntando a la nada. Es gratis mientras esté asignada a una instancia.
- **Abrir el puerto 443 en el firewall de Lightsail.** Viene abierto el 22 y el 80, pero no el 443.
  El síntoma es desconcertante: el certificado se emite bien —eso usa el 80— y después el sitio no
  carga.
- **La instancia no puede usar un rol de IAM** como una EC2. Para S3 hace falta un usuario IAM con
  clave de acceso, con permiso solo sobre ese bucket.

Conviene elegir una imagen **Ubuntu LTS** limpia e instalar Docker, en vez de las preconfiguradas
de Bitnami: traen su propio stack y estorban.

---

## Levantarlo

```bash
git clone https://github.com/cowinance/erpcowinance.git && cd erpcowinance
```

```bash
cp .env.staging.example .env
```

Completar el `.env`: los dominios, los tres secretos (`openssl rand -base64 48`), el bucket, el
SMTP, y el SHA de las imágenes. **Se despliega un SHA, no `latest`**: así se sabe exactamente qué
está corriendo y volver atrás es cambiar una línea. El SHA sale del workflow de Release, que
publica cada commit de `main` después de probar el stack real.

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --no-build
```

`--no-build` es a propósito: se bajan las imágenes ya probadas en vez de construirlas en el
servidor. Si las construyera ahí, estaría corriendo algo que nunca pasó por CI.

Comprobar:

```bash
curl https://api.staging.cowinance.com/v1/healthz && curl https://api.staging.cowinance.com/v1/readyz
```

---

## Después: compilar el APK

**El orden importa y no es negociable.** `EXPO_PUBLIC_API_URL` se hornea dentro del APK al
compilar: si se compila antes de que el servidor exista, el APK apunta a una URL muerta y hay que
rehacerlo.

1. El servidor arriba y respondiendo por HTTPS.
2. En `apps/mobile/.env.local` (no se versiona):
   ```
   EXPO_PUBLIC_API_URL=https://api.staging.cowinance.com/v1
   EXPO_PUBLIC_WEB_URL=https://staging.cowinance.com
   ```
3. `eas login` — lo hace una persona, no la herramienta.
4. `eas init` — vincula el repositorio y escribe el `projectId`.
5. `eas build --platform android --profile preview` — produce un `.apk` con enlace de instalación.

El perfil `preview` ya está en `eas.json`: distribución interna, sin pasar por ninguna tienda.

---

## Tres cosas que rompen y cuesta diagnosticar

**La app instala y no entra.** Casi siempre es la URL horneada. Android además **bloquea HTTP sin
cifrar** en compilaciones de release: una API en `http://` falla sin decir por qué. Por eso el
proxy con TLS no es una comodidad.

**El correo llega y el enlace no sirve.** `APP_BASE_URL` quedó en localhost. Es el más difícil de
ver, justamente porque el correo llegó.

**Las fotos desaparecen al desplegar.** `STORAGE_DRIVER=local` las escribe en el disco del
contenedor. Es la variable que más fácil se olvida porque nada falla hasta el segundo despliegue.

**S3 devuelve 403 al subir una foto.** Casi siempre es la combinación región/estilo, que **no es la
misma en AWS que en R2**: la firma SigV4 usa la región, así que `S3_REGION=auto` contra AWS falla
siempre, y AWS quiere `S3_FORCE_PATH_STYLE=false` mientras R2, MinIO y B2 lo exigen en `true`. El
error de S3 llega completo al log de la API (`docker compose logs api`): el cuerpo XML dice el
motivo real, que el 403 solo no cuenta.

---

## Operación

Actualizar a un commit nuevo: cambiar `API_IMAGE` y `WEB_IMAGE` en el `.env` y repetir el `up -d`.
Las migraciones de base se aplican solas al arrancar.

Respaldo y restauración: `deploy/backup/backup.sh` y `restore.sh`, los mismos que CI ensaya enteros
en cada corrida.

**Los puertos de la API y de la web quedan en el bucle local** (`API_PORT=127.0.0.1:3001`). El único
servicio que habla con internet es Caddy. Si se publicaran en todas las interfaces, cualquiera
podría hablarle a la API en claro por el 3001 y saltearse el TLS. Compose no permite quitar un
mapeo de puertos desde un archivo de superposición —las listas se suman—, así que esa variable es
la forma de acotarlo.

---

## Lo que este entorno NO es

- **No es alta disponibilidad.** Una sola instancia de la API; el rate limit cuenta en memoria.
- **No es producción.** Los datos son descartables y `SEED_DEMO=true` siembra la finca de prueba.
- **No reemplaza probar en el campo.** Sirve para que la app funcione; que sirva con sol directo,
  guantes y batería al 10% se averigua en el corral.
