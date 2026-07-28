'use client';

import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { Button } from '@/components/Button';
import { Field, fieldDescribedBy } from '@/components/Field';
import { PlanillaGuide } from './PlanillaGuide';

/** Batch devuelto por `POST /imports` (DTO + headers del CSV). */
export interface ImportBatch {
  id: string;
  status: string;
  source_filename: string | null;
  total_rows: number;
  mapping: Record<string, string>;
  headers: string[];
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (igual que el límite de Multer en el backend)

/**
 * Copy en español para los `code` de dominio del backend. `import.irregular_row`
 * queda vacío a propósito: su `title` ya trae el número de fila, más útil que un
 * mensaje genérico.
 */
const ERROR_COPY: Record<string, string> = {
  'import.file_required': 'Seleccioná un archivo CSV.',
  'import.empty_file': 'El archivo está vacío.',
  'import.invalid_entity_type': 'Tipo de entidad no soportado.',
  'import.csv_parse_error': 'No se pudo leer el CSV. Revisá el formato (UTF-8, separado por comas).',
  'import.too_many_rows': 'El archivo supera el máximo de 5000 filas.',
  'import.duplicate_headers': 'Hay columnas con encabezados repetidos.',
};

/**
 * Paso «Subir» (P2 P-e.1): elige un CSV, valida en cliente (extensión/tamaño, solo
 * UX; el backend es la autoridad) y lo envía como multipart a `POST /imports` con
 * `entity_type='animal'`. Al crear el batch, entrega batch+headers al asistente.
 */
export function UploadStep({ onUploaded }: { onUploaded: (batch: ImportBatch) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function pick(f: File | null) {
    setError('');
    if (!f) {
      setFile(null);
      return;
    }
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') {
      setError('El archivo debe ser un CSV (.csv).');
      setFile(null);
      return;
    }
    if (f.size === 0) {
      setError('El archivo está vacío.');
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('El archivo supera el máximo de 5 MB.');
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file) {
      setError('Seleccioná un archivo CSV.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file); // el navegador fija Content-Type con el boundary; no lo seteamos
      fd.append('entity_type', 'animal');
      const res = await fetch(`${API_URL}/imports`, { method: 'POST', headers: authHeaders(), body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body?.message?.code ?? body?.code;
        const title = apiErrorTitle(body, '');
        throw new Error((code && ERROR_COPY[code]) || title || `Error ${res.status}`);
      }
      onUploaded(body as ImportBatch);
    } catch (e: any) {
      setError(e.message);
      setUploading(false);
    }
  }

  return (
    <>
      {/* Qué se espera del archivo ANTES de pedirlo: el paso decía cómo tenía que estar guardado
          pero no qué tenía que decir adentro. */}
      <PlanillaGuide />

      <div className="rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
      <Field
        label="Archivo CSV"
        htmlFor="import-file"
        required
        help="CSV UTF-8 separado por comas · hasta 5 MB · hasta 5000 filas. La primera fila debe tener los encabezados."
        error={error || undefined}
      >
        <input
          id="import-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={fieldDescribedBy('import-file', { help: true, error: !!error })}
          aria-invalid={error ? true : undefined}
          onChange={(e) => pick(e.currentTarget.files?.[0] ?? null)}
          className="block w-full text-body text-ink-2 file:mr-3 file:rounded-md file:border file:border-strong file:bg-sunken file:px-3 file:py-1.5 file:text-label file:font-medium file:text-ink-2 hover:file:bg-subtle"
        />
      </Field>

      {file && !error && (
        <p className="mt-3 flex items-center gap-1.5 text-label text-ink-3">
          <UploadCloud size={14} aria-hidden="true" /> {file.name} · {(file.size / 1024).toFixed(0)} KB
        </p>
      )}

      <Button className="mt-5" size="md" loading={uploading} disabled={!file} onClick={submit}>
        {uploading ? 'Subiendo…' : 'Subir y continuar'}
      </Button>
      </div>
    </>
  );
}
