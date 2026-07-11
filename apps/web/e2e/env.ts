import os from 'os';
import path from 'path';

/**
 * Configuración de la suite E2E (P1.3.7). Puertos de test AISLADOS (distintos de
 * los de dev 3000/3001); `global-setup` verifica que estén libres y falla si no
 * (no mata procesos ajenos). Todo lo temporal vive FUERA del repo (os.tmpdir).
 */
export const WEB_PORT = 3210;
export const API_PORT = 3211;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/v1`;

export const TMP_DIR = path.join(os.tmpdir(), 'cowinance-web-e2e');
/** El API escribe su stdout acá; el helper de emails lee este archivo (no hay buzón en la app). */
export const LOG_FILE = path.join(TMP_DIR, 'api.log');

/** Contraseña de prueba: constante NO sensible (no es una credencial real). */
export const PASSWORD = 'CowinanceE2E-2026';
