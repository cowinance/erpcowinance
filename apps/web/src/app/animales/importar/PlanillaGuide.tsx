'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { Button } from '@/components/Button';

export interface ImportField {
  field: string;
  label: string;
  required: boolean;
  /** Encabezados que el servidor auto-mapea a este campo. */
  synonyms: string[];
  /** Valores válidos, si el campo tiene conjunto cerrado. */
  accepts?: string[];
  /** Explicación cuando la lista plana de `accepts` no alcanza (el sexo: cuál es cuál). */
  hint?: string;
}

/**
 * Qué tiene que traer la planilla, y una de ejemplo para bajar (O-4).
 *
 * La pantalla de importación explicaba el formato del ARCHIVO —UTF-8, comas, 5 MB— y ni una palabra
 * sobre su CONTENIDO. Un productor con su planilla de siempre no tenía forma de saber que hacen
 * falta caravana, sexo y categoría, ni que la caravana también puede titularse «arete» o «crotal»,
 * ni que `H` vale por hembra, ni qué categorías existen. La única manera de averiguarlo era subir
 * el archivo y leer qué rebotaba — aprender a fuerza de errores algo que la app ya sabía.
 *
 * **Todo lo que se muestra viene del servidor**, que lo lee de donde se valida de verdad: el sexo
 * del dominio, los orígenes del servicio de alta, las categorías de la base. Nada escrito a mano
 * acá: una ayuda con su propia copia de las reglas es una ayuda que en algún momento va a prometer
 * algo que el importador ya no acepta, y no hay peor error que el que produce la propia guía.
 *
 * La planilla de ejemplo se arma con esos mismos datos y se serializa con el `toCsv` de la casa,
 * que ya neutraliza inyección de fórmulas y pone el BOM para que Excel respete los acentos.
 */
export function PlanillaGuide() {
  const [fields, setFields] = useState<ImportField[] | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [errorBajada, setErrorBajada] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/imports/animal/fields`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFields(Array.isArray(d) ? d : null))
      .catch(() => setFields(null));
  }, []);

  // Sin la lista no se inventa nada: mostrar una ayuda a medias sería peor que no mostrarla.
  if (!fields?.length) return null;

  const obligatorios = fields.filter((f) => f.required);
  const opcionales = fields.filter((f) => !f.required);

  /** El primer sinónimo es el nombre canónico en castellano: el que conviene sugerir. */
  const titulo = (f: ImportField) => f.synonyms[0] ?? f.field;
  async function bajarEjemplo() {
    // Las filas las arma el SERVIDOR: la coherencia entre sexo y categoría («vaca» es hembra,
    // «novillo» es macho) vive en la base. Armándolas acá salía una plantilla que se contradecía
    // sola —«hembra, novillo»— y que el propio importador iba a rechazar.
    setBajando(true);
    try {
      const res = await fetch(`${API_URL}/imports/animal/template`, { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const t = (await res.json()) as { headers: string[]; rows: string[][] };
      downloadCsv('planilla-ejemplo-animales.csv', [t.headers, ...t.rows]);
    } catch {
      setErrorBajada('No se pudo generar la planilla. Reintentá.');
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="mb-4 rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold">Qué tiene que traer tu planilla</h2>
          <p className="mt-0.5 text-label text-ink-3">
            Tres columnas obligatorias. El resto es opcional y se puede agregar después.
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={bajando} onClick={bajarEjemplo}>
          <Download size={14} aria-hidden="true" /> {bajando ? 'Generando…' : 'Descargar planilla de ejemplo'}
        </Button>
      </div>

      <dl className="mt-4 space-y-3">
        {obligatorios.map((f) => (
          <div key={f.field} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-label font-medium">
              {f.label} <span className="text-danger">*</span>
            </dt>
            <dd className="min-w-0 text-label text-ink-3">
              Titulá la columna <Codigo>{titulo(f)}</Codigo>
              {f.synonyms.length > 1 && <> — también sirve {f.synonyms.slice(1, 4).map((s, i) => (
                <span key={s}>{i > 0 && ', '}<Codigo>{s}</Codigo></span>
              ))}</>}
              {f.hint ? (
                <div className="mt-0.5">Valores: {f.hint}</div>
              ) : f.accepts?.length ? (
                <div className="mt-0.5">
                  Valores: {f.accepts.map((v, i) => (
                    <span key={v}>{i > 0 && ' · '}<Codigo>{v}</Codigo></span>
                  ))}
                </div>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="mt-3 text-label font-medium text-brand hover:underline"
      >
        {abierta ? 'Ocultar' : `Ver las ${opcionales.length} columnas opcionales`}
      </button>

      {abierta && (
        <dl className="mt-3 space-y-2 border-t border-subtle pt-3">
          {opcionales.map((f) => (
            <div key={f.field} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="w-40 shrink-0 text-label font-medium text-ink-2">{f.label}</dt>
              <dd className="min-w-0 text-label text-ink-3">
                <Codigo>{titulo(f)}</Codigo>
                {f.accepts?.length ? <> — valores: {f.accepts.join(' · ')}</> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {errorBajada && <p className="mt-3 text-label text-danger">{errorBajada}</p>}

      <p className="mt-4 text-label text-ink-3">
        Si tus columnas se llaman de otra forma, no importa: en el paso siguiente las asignás a mano.
      </p>
    </div>
  );
}

function Codigo({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-sunken px-1 py-px font-mono text-compat-11 text-ink-2">{children}</code>;
}
