import { DIRECT_API_URL } from '@/lib/api';

/**
 * Guardia de arranque de la web: si el servidor no puede hablar con la API, NO arranca.
 *
 * POR QUÉ EXISTE. `NEXT_PUBLIC_API_URL` se INLINEA en el bundle durante el build, no se lee en
 * runtime. Reconstruir la imagen sin pasarla deja la URL en el default de desarrollo
 * (`http://localhost:3001/v1`), que dentro de un contenedor no es nadie. La web arranca igual, las
 * páginas se ven bien, y el fallo aparece recién cuando alguien intenta registrarse y el catálogo
 * de países devuelve 502. Pasó en producción exactamente así.
 *
 * Desde entonces existe `API_INTERNAL_URL`, que SÍ se lee al arrancar y tiene precedencia (ver
 * `lib/api.ts`). Esta guardia sigue haciendo falta igual: que la variable se lea en runtime no
 * garantiza que la URL sea alcanzable —puerto cambiado, API caída, red mal armada— y ese es el
 * fallo que acá se atrapa.
 *
 * Es el mismo criterio que ya aplicamos a `JWT_SECRET` y a `DATABASE_URL` en la API: un despliegue
 * mal configurado tiene que morir al arrancar, donde lo ve quien despliega, y no meses después
 * donde lo sufre un usuario.
 *
 * SE COMPRUEBA LA CONEXIÓN, NO EL TEXTO DE LA URL. Rechazar `localhost` por su forma daría falsos
 * positivos —hay despliegues donde web y API comparten host y localhost es correcto— y no atraparía
 * el resto de los motivos por los que la API puede no estar: puerto cambiado, contenedor caído, red
 * mal armada. La pregunta real es una sola: ¿se llega?
 */

/** El default de desarrollo. Solo se usa para dar un mensaje más preciso cuando encima no se llega. */
const DEV_DEFAULT = 'http://localhost:3001/v1';

/**
 * Catálogo de países: es público y es exactamente lo que carga la pantalla de registro. Probar con
 * él comprueba el contrato que le importa a una persona —«¿alguien puede crear su cuenta?»— y no
 * una ruta de salud que puede responder aunque lo demás esté roto.
 */
const PROBE_PATH = '/catalogs/countries';

const ATTEMPTS = 10;
const DELAY_MS = 6_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reachable(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    return res.ok ? null : `respondió ${res.status}`;
  } catch (e) {
    return (e as Error).message || 'no se pudo conectar';
  }
}

export async function register(): Promise<void> {
  // Solo en el servidor Node y solo en producción: en desarrollo levantar la web sin la API es
  // normal —se arranca una y después la otra— y hacerlo fallar sería pelearse con el flujo de trabajo.
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Durante `next build` no hay ninguna API a la que llegar —ni tiene que haberla: la imagen se
  // construye en CI—. Sin esta guarda, el propio build moriría.
  if (process.env.NEXT_PHASE?.includes('build')) return;

  const target = `${DIRECT_API_URL}${PROBE_PATH}`;
  let motivo: string | null = null;

  // Se reintenta porque el orden de arranque no está garantizado: con `depends_on` el contenedor de
  // la API existe, pero puede estar todavía cargando el esquema. Un fallo acá no es definitivo: con
  // `restart: unless-stopped` el contenedor vuelve a intentar y se resuelve solo cuando la API sube.
  for (let intento = 1; intento <= ATTEMPTS; intento++) {
    motivo = await reachable(target);
    if (motivo === null) {
      console.log(`[web] API alcanzable en ${DIRECT_API_URL}`);
      return;
    }
    if (intento < ATTEMPTS) {
      console.warn(`[web] La API no responde en ${DIRECT_API_URL} (${motivo}). Reintento ${intento}/${ATTEMPTS - 1}…`);
      await sleep(DELAY_MS);
    }
  }

  const pista =
    DIRECT_API_URL === DEV_DEFAULT
      ? '\n\nLa URL es el DEFAULT DE DESARROLLO: no llegó ninguna configuración. Lo más rápido es ' +
        'definir `API_INTERNAL_URL`, que se lee AL ARRANCAR y no necesita reconstruir nada:\n' +
        '  · con pm2:    agregá API_INTERNAL_URL=http://127.0.0.1:3001/v1 al .env y reiniciá\n' +
        '  · con compose: API_INTERNAL_URL=http://api:3001/v1 docker compose -f docker-compose.prod.yml up -d web\n' +
        '(`NEXT_PUBLIC_API_URL` también sirve, pero se inlinea en el build: exige reconstruir.)'
      : '\n\nLa configuración llegó; lo que falla es el destino. Revisá que la API esté levantada y que ' +
        'esa URL sea alcanzable DESDE EL PROCESO DE LA WEB (dentro de la red de compose el host es el ' +
        'nombre del servicio, `api`, no `localhost`; con pm2 en el mismo host, `127.0.0.1`).';

  // Se sale del proceso a mano. Next ATRAPA lo que lance `register()` y sigue sirviendo igual: un
  // `throw` acá deja el mismo despliegue roto de antes, con un error más en el log que nadie mira.
  // Comprobado levantando el servidor construido contra una API inalcanzable.
  console.error(
    `\n[web] La web no puede hablar con la API y por eso no arranca.\n` +
      `  URL configurada: ${DIRECT_API_URL}\n` +
      `  Se probó:        ${target}\n` +
      `  Último error:    ${motivo}` +
      pista +
      '\n',
  );
  process.exit(1);
}
