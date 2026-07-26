# Archivos en S3 — pasar de disco efímero a almacén de objetos

**Por qué importa:** hoy la API corre con `STORAGE_DRIVER=local`, que guarda las fotos y documentos
en `.data/uploads` **dentro del disco del proceso**. En el servidor eso significa que **cada deploy
se las lleva**. Es lo único de la configuración pendiente que puede perder datos del productor.

El código ya está: adaptador S3 con firma SigV4 propia (sin SDK), selección por `STORAGE_DRIVER`, y
un aviso en el arranque si queda `local` en producción. Lo que falta es la configuración.

**Verificado el 26/07/2026** contra un MinIO real: las 5 pruebas de integración del adaptador, la
migración con rutas anidadas / espacios / acentos / bytes binarios, y el circuito completo por la
API (subir una foto → el objeto queda en el bucket → leerla devuelve los mismos bytes).

---

## 1. Crear el bucket y las credenciales (lo hacés vos, en AWS)

No lo puede hacer el asistente: requiere entrar con tus credenciales de AWS.

1. **Bucket** en S3, misma región que la base (`us-east-2`), nombre por ejemplo `cowinance-media`.
2. **Bloquear todo el acceso público** (opción por defecto, dejarla marcada). Los archivos NO se
   sirven directo desde el bucket: la app los lee y los entrega con un token firmado que vence, así
   que el bucket no necesita ser público nunca.
3. **Versionado: activado.** Es la red contra un borrado o una sobreescritura accidental, y sobre
   fotos de campo el costo es despreciable.
4. **Usuario IAM** propio para la app (no tu usuario), con acceso programático, y esta política —
   solo lo que la app usa, y solo sobre ese bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::cowinance-media/*"
    }
  ]
}
```

La app **no borra ni lista** objetos: no hace falta `s3:DeleteObject` ni `s3:ListBucket`. Si más
adelante alguna función los necesita, que se agreguen entonces y no por las dudas.

---

## 2. Variables en el servidor

En el `.env` de producción (junto a las que ya están):

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.us-east-2.amazonaws.com
S3_BUCKET=cowinance-media
S3_REGION=us-east-2
S3_ACCESS_KEY_ID=<la del usuario IAM>
S3_SECRET_ACCESS_KEY=<la del usuario IAM>
S3_FORCE_PATH_STYLE=false
```

**`S3_FORCE_PATH_STYLE=false` es obligatorio en AWS.** El valor por defecto es `true` porque R2,
MinIO y Backblaze lo exigen; AWS usa virtual-hosted (`https://bucket.s3.region.amazonaws.com/clave`)
y con `true` responde errores que no explican el motivo.

**`S3_REGION` tiene que ser la región real del bucket.** Si no coincide, AWS contesta 301 o 400. El
script de migración traduce ese caso a un mensaje que lo dice.

---

## 3. Migrar lo que ya está en el disco

**Antes de cambiar `STORAGE_DRIVER`.** Si se prende S3 primero, los archivos viejos no se borran
—siguen en el disco— pero la app deja de encontrarlos, porque busca en el bucket. Y el deploy
siguiente sí se los lleva de verdad.

La migración es una copia y nada más: los dos adaptadores usan la misma clave (`<tenant>/<archivo>`)
y la base guarda la clave, no la ubicación física.

```bash
cd /ruta/al/repo
npm run build --workspace=@cowinance/api   # el script usa el firmador compilado, no una copia

# 1. Prueba: no sube nada, valida credenciales y lista lo que copiaría.
S3_ENDPOINT=... S3_BUCKET=... S3_REGION=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
S3_FORCE_PATH_STYLE=false \
  node apps/api/scripts/migrate-uploads-to-s3.mjs --dry-run

# 2. La copia de verdad (mismas variables, sin --dry-run).
```

El `--dry-run` sirve además como **prueba de la configuración**: hace un HEAD contra el bucket antes
de tocar nada y traduce el error a algo accionable (403 → credenciales o permisos; 301/400 → región;
fallo de conexión → endpoint).

Es idempotente: lo que ya está subido con el mismo tamaño se saltea, así que se puede cortar y
retomar. Si algún archivo falla, **sale con código 1 y avisa que no cambies `STORAGE_DRIVER`**.

---

## 4. Prender y verificar

```bash
# En el .env: STORAGE_DRIVER=s3
pm2 restart cowinance-api
pm2 logs cowinance-api --lines 30 | grep -i "Archivos:"
```

Tiene que decir `Archivos: S3 (…, bucket cowinance-media)`. Si dice `disco local`, la variable no
llegó al proceso.

Después, la prueba que vale: **subir una foto desde la app y volver a verla**, y luego reiniciar la
API y verla otra vez. Lo segundo es lo que antes fallaba.

---

## 5. Correr las pruebas del adaptador contra el bucket real (opcional)

Las 5 pruebas de integración escriben y leen objetos de prueba bajo la clave `tenant-de-prueba/`.
Sirven para validar credenciales y firma sin pasar por la app:

```bash
S3_TEST=1 S3_ENDPOINT=... S3_BUCKET=... S3_REGION=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
S3_FORCE_PATH_STYLE=false \
  npx vitest run apps/api/src/infra/storage
```

Dejan basura en `tenant-de-prueba/` — borrable a mano, o correrlas contra un bucket aparte.

---

## Lo que queda pendiente después de esto

- **Rotar las claves expuestas**: la contraseña maestra de RDS y la de SMTP se compartieron en texto
  plano durante las pruebas. Tratarlas como comprometidas antes de que entren datos reales.
- **`NEXT_PUBLIC_API_URL`** apuntando al host local + rebuild de la web (se inlinea en build, no se
  lee en runtime).
- **Verificar que `cowinance_app` tenga `rolsuper=false` y `rolbypassrls=false`** — si es
  superusuario, la RLS no se aplica y el aislamiento entre fincas es solo aparente.
