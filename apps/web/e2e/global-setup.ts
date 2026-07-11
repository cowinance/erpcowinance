import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { WEB_PORT, API_PORT, WEB_URL, API_URL, TMP_DIR, LOG_FILE } from './env';

/**
 * Orquestador de instancias AISLADAS para los E2E (P1.3.7). Levanta:
 *  - API: `apps/api/dist/main.js` con SEED_DEMO=off + EMAIL_PROVIDER=log, cwd en un
 *    temp fuera del repo (la `.data` de PGlite cae ahí) y stdout → api.log (el
 *    helper de emails lee ese log; no se agrega ningún buzón a la app).
 *  - Web: `next dev` apuntando NEXT_PUBLIC_API_URL al API de test.
 * Devuelve un teardown que mata los procesos (por grupo, detached) y borra el temp
 * —incluso si algún test falla—. No mata procesos ajenos: si un puerto está
 * ocupado, aborta con un mensaje claro.
 */
const REPO_ROOT = path.resolve(__dirname, '../../..');

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return; // el servidor responde
    } catch {
      /* aún no está arriba */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout esperando ${url}`);
}

function killTree(child: ChildProcess): void {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, 'SIGTERM'); // grupo (detached) → mata npm+next / node
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ya murió */
    }
  }
}

export default async function globalSetup() {
  for (const [name, port] of [
    ['web', WEB_PORT],
    ['api', API_PORT],
  ] as const) {
    if (!(await portFree(port))) {
      throw new Error(`Puerto ${port} (${name}) ocupado. Liberalo o ajustá apps/web/e2e/env.ts. No se matan procesos ajenos.`);
    }
  }

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const apiEntry = path.join(REPO_ROOT, 'apps/api/dist/main.js');
  if (!fs.existsSync(apiEntry)) {
    throw new Error(`API no compilada (${apiEntry}). Corré: npm run build -w @cowinance/api`);
  }

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const api = spawn(process.execPath, [apiEntry], {
    cwd: TMP_DIR, // la .data de PGlite cae acá (fuera del repo)
    detached: true,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      SEED_DEMO: 'off',
      EMAIL_PROVIDER: 'log',
      JWT_SECRET: 'e2e-secret-not-for-prod',
      APP_BASE_URL: WEB_URL,
      NODE_ENV: 'development',
    },
  });
  api.stdout?.pipe(logStream);
  api.stderr?.pipe(logStream);

  const web = spawn('npm', ['run', 'dev', '--', '-p', String(WEB_PORT)], {
    cwd: path.join(REPO_ROOT, 'apps/web'),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NEXT_PUBLIC_API_URL: API_URL },
  });

  try {
    await waitFor(`${API_URL}/catalogs/countries`, 60_000);
    await waitFor(`${WEB_URL}/login`, 120_000);
  } catch (err) {
    killTree(api);
    killTree(web);
    throw err;
  }

  return async () => {
    killTree(api);
    killTree(web);
    await new Promise((r) => setTimeout(r, 500));
    try {
      logStream.end();
    } catch {
      /* noop */
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  };
}
