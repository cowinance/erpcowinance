/**
 * Fuente canónica ÚNICA de países soportados para el provisioning de tenants
 * (P1.1) y su representación pública de lectura (P1.3.2, ADR-0012): nombre
 * visible + moneda funcional, locale y zona horaria. Cubre los países del
 * catálogo base (`bootstrapCatalogs`). Para códigos fuera del mapa se usa un
 * default neutro (USD/es/UTC).
 *
 * Inline a propósito (ADR-0006 / YAGNI): es una tabla de arranque de tenant, no
 * una regla de dominio; no amerita un Value Object, un servicio ni un paquete
 * compartido todavía. El endpoint público es solo una vista de lectura de esta
 * definición — la validación del registro sigue usando la misma fuente.
 */
export interface CountryDefaults {
  currency: string;
  locale: string;
  timezone: string;
}

/** Entrada canónica: nombre visible + defaults de provisioning. */
interface CountryConfig extends CountryDefaults {
  name: string;
}

const SUPPORTED: Record<string, CountryConfig> = {
  AR: { name: 'Argentina', currency: 'ARS', locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires' },
  UY: { name: 'Uruguay', currency: 'UYU', locale: 'es-UY', timezone: 'America/Montevideo' },
  MX: { name: 'México', currency: 'MXN', locale: 'es-MX', timezone: 'America/Mexico_City' },
  CO: { name: 'Colombia', currency: 'COP', locale: 'es-CO', timezone: 'America/Bogota' },
  US: { name: 'Estados Unidos', currency: 'USD', locale: 'en-US', timezone: 'America/Chicago' },
  BR: { name: 'Brasil', currency: 'BRL', locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
};

const FALLBACK: CountryDefaults = { currency: 'USD', locale: 'es', timezone: 'UTC' };

/** Defaults de provisioning para un código ISO-3166 alpha-2 (case-insensitive). Fallback neutro si no está mapeado. */
export function countryDefaults(countryCode: string): CountryDefaults {
  const c = SUPPORTED[countryCode.toUpperCase()];
  if (!c) return FALLBACK;
  return { currency: c.currency, locale: c.locale, timezone: c.timezone };
}

/** ¿El país está soportado para registro? (misma fuente canónica). */
export function isSupportedCountry(countryCode: string): boolean {
  return countryCode.toUpperCase() in SUPPORTED;
}

/**
 * DTO público de un país para el formulario de registro (P1.3.2): SOLO
 * `code` + `name`. NO expone currency/locale/timezone (config interna de
 * provisioning). Es un contrato estable y explícito, no la entrada interna.
 */
export interface CountryOption {
  code: string;
  name: string;
}

/**
 * Lista pública de países soportados (`code` + `name`), construida
 * explícitamente desde la fuente canónica `SUPPORTED`. Vista de lectura: no
 * duplica la lista ni filtra campos internos.
 */
export function supportedCountries(): CountryOption[] {
  return Object.entries(SUPPORTED).map(([code, c]) => ({ code, name: c.name }));
}
