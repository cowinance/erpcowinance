/**
 * Valores por defecto por país para provisionar una organización nueva (P1.1):
 * moneda funcional, locale y zona horaria. Cubre los países del catálogo base
 * (`bootstrapCatalogs`). Para países fuera del mapa se usa un default neutro
 * (USD/es/UTC) — el onboarding posterior permitirá ajustarlo.
 *
 * Inline a propósito (ADR-0006 / YAGNI): es una tabla de arranque de tenant, no
 * una regla de dominio; no amerita un Value Object ni un servicio todavía.
 */
export interface CountryDefaults {
  currency: string;
  locale: string;
  timezone: string;
}

const DEFAULTS: Record<string, CountryDefaults> = {
  AR: { currency: 'ARS', locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires' },
  UY: { currency: 'UYU', locale: 'es-UY', timezone: 'America/Montevideo' },
  MX: { currency: 'MXN', locale: 'es-MX', timezone: 'America/Mexico_City' },
  CO: { currency: 'COP', locale: 'es-CO', timezone: 'America/Bogota' },
  US: { currency: 'USD', locale: 'en-US', timezone: 'America/Chicago' },
  BR: { currency: 'BRL', locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
};

const FALLBACK: CountryDefaults = { currency: 'USD', locale: 'es', timezone: 'UTC' };

/** Defaults para un código ISO-3166 alpha-2 (case-insensitive). Fallback neutro si no está mapeado. */
export function countryDefaults(countryCode: string): CountryDefaults {
  return DEFAULTS[countryCode.toUpperCase()] ?? FALLBACK;
}

/** ¿El país está en el catálogo base soportado? */
export function isSupportedCountry(countryCode: string): boolean {
  return countryCode.toUpperCase() in DEFAULTS;
}
