import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/**
 * Registro de banderas conocidas (A3 · Configuración). El mecanismo es genérico: cada tenant guarda su
 * estado en `feature_flags` (UNIQUE tenant+flag_key); la ausencia de fila = el default del registro.
 * El código que quiera condicionar una función pregunta por `isEnabled(key)`. Agregar una bandera nueva
 * = una entrada acá (fuente única de la verdad de qué banderas existen y qué significan).
 */
/**
 * Banderas de MÓDULO: activan/desactivan la visibilidad de un módulo en la finca (el sidebar web las
 * lee y oculta los apagados). Son las "módulos que se activan por tenant" del catálogo. Default: true
 * (todo visible; el tenant apaga lo que no usa — un feedlot de carne apaga Tambo, un tambo apaga Faena).
 * El `key` `module_<x>` empareja con un href del sidebar (ver MODULE_FLAG en Sidebar.tsx).
 */
export const FLAG_REGISTRY = [
  { key: 'module_dairy', label: 'Tambo (lechería)', description: 'Producción lechera, tanques, entregas y calidad de leche.', default: true },
  { key: 'module_feedlot', label: 'Engorde a corral', description: 'Panel de feedlot: conversión, costo del kilo ganado y terminación.', default: true },
  { key: 'module_breeding', label: 'Cría y recría', description: 'Eficiencia del rodeo de cría: destete, reposición, kg destetados/ha.', default: true },
  { key: 'module_slaughter', label: 'Faena', description: 'Registro de res y rendimiento (dressing) por lote y padre.', default: true },
  { key: 'module_genetics', label: 'Genética', description: 'Semen/embriones, consumo en inseminación y evaluaciones.', default: true },
  { key: 'module_lab', label: 'Laboratorio', description: 'Muestras, estados y resultados de laboratorio.', default: true },
  { key: 'module_agriculture', label: 'Agricultura', description: 'Cultivos, labores y cosechas sobre potreros.', default: true },
  { key: 'module_grazing', label: 'Pastoreo', description: 'Rotación y métricas de pastoreo por potrero.', default: true },
  { key: 'module_machinery', label: 'Maquinaria', description: 'Máquinas, mantenimiento y combustible.', default: true },
  { key: 'module_traceability', label: 'Trazabilidad', description: 'Guías de traslado y certificaciones.', default: true },
  { key: 'module_weather', label: 'Clima', description: 'Estaciones meteorológicas, índices agroclimáticos y alertas por calor y helada.', default: true },
  { key: 'module_marketplace', label: 'Marketplace', description: 'Comercialización de hacienda (próximamente).', default: true },
  { key: 'module_academy', label: 'Academia', description: 'Cursos y capacitación (próximamente).', default: true },
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
