import type { NextConfig } from 'next';
import { join } from 'path';

const nextConfig: NextConfig = {
  /**
   * `standalone` produce en `.next/standalone` un servidor con SOLO las dependencias que el build
   * rastreó: es lo que hace que la imagen de la web pese decenas de MB en vez de arrastrar el
   * `node_modules` entero del monorepo. `next dev` y `next start` no cambian.
   */
  output: 'standalone',
  /**
   * Sin esto el rastreo arranca en `apps/web` y se pierde el `node_modules` hoisteado en la raíz
   * del monorepo (npm workspaces): el standalone quedaría sin dependencias y fallaría al arrancar.
   */
  outputFileTracingRoot: join(__dirname, '../..'),
};

export default nextConfig;
