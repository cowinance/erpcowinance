/**
 * Copia los archivos que hoy viven en el disco del proceso hacia el almacén S3.
 *
 * Se corre UNA VEZ, en el servidor, ANTES de pasar `STORAGE_DRIVER` a `s3`. Sin este paso, prender
 * S3 no borra las fotos viejas —siguen en el disco— pero la app deja de encontrarlas: la próxima
 * lectura va al bucket, donde no están. Y como el disco es efímero, el deploy siguiente sí se las
 * lleva de verdad.
 *
 * **Por qué la migración es una copia y nada más:** los dos adaptadores usan EXACTAMENTE la misma
 * clave (`<tenant>/<archivo>`). No hay rutas que reescribir ni referencias en la base que tocar —
 * `media` y `documents` guardan la clave, no la ubicación física. Eso es lo que hace que este
 * script pueda ser corto y que se pueda correr dos veces sin romper nada.
 *
 * **La firma la hace `dist/infra/storage/s3-signer.js`, no una copia local.** SigV4 escrito dos
 * veces son dos cosas que pueden diferir, y la que fallaría es justo la que nadie prueba. Se usa el
 * compilado porque en el servidor la API ya corre desde `dist/`, así que el código está ahí y es el
 * mismo que la app usa para subir cada foto.
 *
 * Idempotente: lo que ya está en el bucket con el mismo tamaño no se vuelve a subir. Se puede
 * cortar a la mitad y volver a arrancar.
 *
 * Uso, con las MISMAS variables que va a usar la app (así se prueba la config real, no otra):
 *
 *   cd /ruta/al/repo
 *   npm run build --workspace=@cowinance/api      # si dist/ no está al día
 *   S3_ENDPOINT=... S3_BUCKET=... S3_REGION=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *     node apps/api/scripts/migrate-uploads-to-s3.mjs --dry-run
 *
 * Opciones:
 *   --dry-run          lista lo que subiría, sin subir nada. Correr esto PRIMERO.
 *   --root <ruta>      raíz de los archivos locales (por defecto `apps/api/.data/uploads`)
 *   --force            re-sube aunque el objeto ya exista con el mismo tamaño
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = flag('--dry-run');
const FORCE = flag('--force');
const API = resolve(join(process.cwd(), 'apps', 'api'));
const ROOT = resolve(value('--root', join(API, '.data', 'uploads')));

// El firmador real, compilado. Si falta, es que no se hizo el build: se dice, en vez de caerse con
// un "Cannot find module" que no explica nada.
const signerPath = join(API, 'dist', 'infra', 'storage', 's3-signer.js');
if (!existsSync(signerPath)) {
  console.error(`No está el firmador compilado en ${signerPath}.\nCorré primero:  npm run build --workspace=@cowinance/api`);
  process.exit(1);
}
const { signS3Request } = await import(pathToFileURL(signerPath).href);

const cfg = {
  endpoint: (process.env.S3_ENDPOINT ?? '').trim().replace(/\/+$/, ''),
  bucket: (process.env.S3_BUCKET ?? '').trim(),
  region: (process.env.S3_REGION ?? '').trim() || 'auto',
  accessKeyId: (process.env.S3_ACCESS_KEY_ID ?? '').trim(),
  secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY ?? '').trim(),
  sessionToken: (process.env.S3_SESSION_TOKEN ?? '').trim() || undefined,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? '').trim().toLowerCase() !== 'false',
};

const FALTANTES = { endpoint: 'S3_ENDPOINT', bucket: 'S3_BUCKET', accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY' };
const faltan = Object.keys(FALTANTES).filter((k) => !cfg[k]);
if (faltan.length > 0) {
  console.error(`Faltan variables: ${faltan.map((k) => FALTANTES[k]).join(', ')}`);
  process.exit(1);
}
if (!existsSync(ROOT)) {
  console.log(`No hay nada que migrar: ${ROOT} no existe.`);
  process.exit(0);
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
};
const contentTypeDe = (nombre) => CONTENT_TYPES[nombre.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

const firmar = (method, key, payload, contentType) => signS3Request({ ...cfg, method, key, payload, contentType, now: new Date() });

/** Todos los archivos bajo la raíz, con su clave = ruta relativa en POSIX. */
function* archivos(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* archivos(full);
    else if (entry.isFile()) yield { full, key: relative(ROOT, full).split(sep).join('/') };
  }
}

console.log(`Origen : ${ROOT}`);
console.log(`Destino: ${cfg.endpoint}/${cfg.bucket} (${cfg.forcePathStyle ? 'path-style' : 'virtual-hosted'}, región ${cfg.region})`);

/**
 * Chequeo previo de credenciales y endpoint.
 *
 * Sin esto, una clave mal copiada aparece como 200 líneas de `✗ archivo: 403` y hay que leerlas
 * todas para entender que el problema era uno solo. Un HEAD sobre una clave que no existe alcanza:
 * si las credenciales sirven, S3 contesta 404 — que acá es la respuesta BUENA.
 *
 * Corre también en `--dry-run`, y eso lo vuelve lo más útil del script: probar la configuración
 * antes de tocar un solo archivo.
 */
{
  // GET y no HEAD: un HEAD no devuelve cuerpo, y el cuerpo es donde S3 dice QUÉ falló. Sin él, todo
  // problema se ve igual —«403»— y no se puede distinguir una credencial mal copiada de una
  // política a la que le falta un permiso.
  const probe = firmar('GET', `.cowinance-probe-${Date.now()}`);
  let res, cuerpo = '';
  try {
    res = await fetch(probe.url, { method: 'GET', headers: probe.headers });
    cuerpo = await res.text();
  } catch (e) {
    console.error(`\nNo se pudo llegar a ${cfg.endpoint}: ${e.message}`);
    console.error('Revisá S3_ENDPOINT (y que el servidor tenga salida a internet).');
    process.exit(1);
  }
  const codigo = (cuerpo.match(/<Code>(.*?)<\/Code>/) ?? [])[1] ?? '';
  const mensaje = (cuerpo.match(/<Message>(.*?)<\/Message>/) ?? [])[1] ?? '';

  if (res.status === 403) {
    /**
     * **Un 403 acá NO significa que la configuración esté mal, y creer que sí costó un diagnóstico
     * equivocado.**
     *
     * Cuando se pide un objeto que NO EXISTE y la política no incluye `s3:ListBucket`, S3 contesta
     * 403 en vez de 404 — a propósito, para no revelar si la clave existe. Y la política que
     * recomienda `docs/ops/s3-archivos.md` omite `ListBucket` justamente por mínimo privilegio.
     *
     * O sea que la configuración CORRECTA producía el mensaje «las credenciales no sirven». Ahora
     * se distingue por el permiso que S3 nombra: si el que falta es `ListBucket`, las credenciales
     * son válidas —S3 pudo identificar al usuario para poder negarle algo— y lo que hay es
     * exactamente la política mínima esperada.
     */
    if (/ListBucket/.test(mensaje)) {
      console.log('Credenciales OK (política mínima, sin s3:ListBucket — es lo esperado).');
    } else if (/SignatureDoesNotMatch/.test(codigo)) {
      console.error('\nLa FIRMA no coincide. Suele ser el secreto mal copiado, o S3_REGION distinta de la del bucket.');
      console.error(`  ${mensaje}`);
      process.exit(1);
    } else if (/InvalidAccessKeyId|TokenRefreshRequired|ExpiredToken/.test(codigo)) {
      console.error(`\nLa credencial no es válida (${codigo}).`);
      console.error(`  ${mensaje}`);
      process.exit(1);
    } else {
      console.error(`\nEl almacén respondió 403 (${codigo || 'AccessDenied'}).`);
      console.error(`  ${mensaje}`);
      console.error('La política del usuario IAM tiene que permitir s3:PutObject y s3:GetObject sobre el bucket.');
      process.exit(1);
    }
  } else if (res.status === 404 || res.ok) {
    console.log('Credenciales OK.');
  } else if (res.status === 301 || res.status === 400) {
    // AWS devuelve 301/400 cuando la región del bucket no es la que se firmó.
    console.error(`\nEl almacén respondió ${res.status}. Suele ser la REGIÓN equivocada: S3_REGION tiene que ser la del bucket.`);
    process.exit(1);
  } else {
    console.error(`\nRespuesta inesperada del almacén: ${res.status} ${res.statusText}. Revisá S3_BUCKET y S3_FORCE_PATH_STYLE.`);
    process.exit(1);
  }
}

if (DRY) console.log('MODO PRUEBA: no se sube nada.\n');

let subidos = 0, saltados = 0, fallidos = 0, bytes = 0;

for (const { full, key } of archivos(ROOT)) {
  const tamano = statSync(full).size;
  try {
    if (!FORCE) {
      // HEAD antes de subir: reintentar una migración cortada no debería re-subir todo de nuevo.
      const head = firmar('HEAD', key);
      const res = await fetch(head.url, { method: 'HEAD', headers: head.headers });
      if (res.ok && Number(res.headers.get('content-length')) === tamano) {
        saltados++;
        continue;
      }
    }
    if (DRY) {
      console.log(`  subiría  ${key} (${tamano} bytes)`);
      subidos++;
      bytes += tamano;
      continue;
    }
    const body = readFileSync(full);
    const put = firmar('PUT', key, body, contentTypeDe(key));
    const res = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
    subidos++;
    bytes += tamano;
    if (subidos % 25 === 0) console.log(`  ${subidos} subidos…`);
  } catch (e) {
    fallidos++;
    console.error(`  ✗ ${key}: ${e.message}`);
  }
}

console.log(`\n${DRY ? 'Subiría' : 'Subidos'}: ${subidos} (${(bytes / 1024 / 1024).toFixed(1)} MB) · ya estaban: ${saltados} · fallidos: ${fallidos}`);
if (fallidos > 0) {
  // Prender S3 con archivos sin copiar deja fotos que la app ya no encuentra. El código de salida
  // es lo que hace que un despliegue automatizado se entere en vez de seguir de largo.
  console.error('\nHay archivos sin copiar. NO cambies STORAGE_DRIVER hasta resolverlos.');
  process.exit(1);
}
if (!DRY && subidos + saltados > 0) console.log('\nListo. Ahora sí: STORAGE_DRIVER=s3 y reiniciar la API.');
