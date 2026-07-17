import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Registro de banderas conocidas (A3 · Configuración). El mecanismo es genérico: cada tenant guarda su
 * estado en `feature_flags` (UNIQUE tenant+flag_key); la ausencia de fila = el default del registro.
 * El código que quiera condicionar una función pregunta por `isEnabled(key)`. Agregar una bandera nueva
 * = una entrada acá (fuente única de la verdad de qué banderas existen y qué significan).
 */
export const FLAG_REGISTRY = [
  { key: 'regional_benchmarking', label: 'Benchmarking regional', description: 'Comparación anónima de indicadores (preñez, GDP, costo/kg) con otras fincas de la región. Opt-in.', default: false },
  { key: 'voice_capture', label: 'Captura por voz en manga', description: 'Registro por voz de pesajes y eventos en el modo manga.', default: false },
  { key: 'push_notifications', label: 'Notificaciones push', description: 'Envío de notificaciones push a los dispositivos móviles de la finca.', default: false },
  { key: 'advisor_access', label: 'Acceso de asesores externos', description: 'Habilita delegaciones temporales con vencimiento para técnicos y asesores.', default: false },
] as const;

export type FlagKey = (typeof FLAG_REGISTRY)[number]['key'];
const REGISTRY_KEYS = new Set<string>(FLAG_REGISTRY.map((f) => f.key));

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly db: DbService) {}

  /** Estado resuelto de cada bandera del registro: el valor guardado del tenant, o el default. */
  async list() {
    const stored = await this.db.query<{ flag_key: string; is_enabled: boolean }>(
      `SELECT flag_key, is_enabled FROM feature_flags WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const byKey = new Map(stored.map((s) => [s.flag_key, s.is_enabled]));
    return FLAG_REGISTRY.map((f) => ({ key: f.key, label: f.label, description: f.description, enabled: byKey.has(f.key) ? byKey.get(f.key)! : f.default }));
  }

  /** ¿Está activa una bandera para el tenant actual? (default del registro si no hay fila). */
  async isEnabled(key: FlagKey): Promise<boolean> {
    const row = await this.db.one<{ is_enabled: boolean }>(`SELECT is_enabled FROM feature_flags WHERE tenant_id=$1 AND flag_key=$2 AND deleted_at IS NULL`, [this.db.tenant, key]);
    if (row) return row.is_enabled;
    return FLAG_REGISTRY.find((f) => f.key === key)?.default ?? false;
  }

  /** Activa/desactiva una bandera conocida (upsert por tenant+flag_key). */
  async set(body: { key?: unknown; enabled?: unknown }) {
    const key = String(body?.key ?? '');
    if (!REGISTRY_KEYS.has(key)) throw new BadRequestException({ code: 'config.unknown_flag', title: `Bandera desconocida: ${key}` });
    const enabled = Boolean(body?.enabled);
    await this.db.query(
      `INSERT INTO feature_flags (tenant_id, flag_key, is_enabled, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, flag_key) DO UPDATE SET is_enabled=EXCLUDED.is_enabled, updated_at=now()`,
      [this.db.tenant, key, enabled, this.db.user],
    );
    return this.list();
  }
}
