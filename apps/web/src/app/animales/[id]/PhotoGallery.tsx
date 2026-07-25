'use client';

/**
 * Galería multimedia del animal (Módulo Animales §11): subir fotos, ver la
 * galería, elegir la foto principal y eliminar. La subida convierte la imagen
 * a data URL base64; el servidor la guarda y devuelve una URL firmada.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders, fileUrl, PhotoRef } from '@/lib/api';
import { formatBytes, prepareImageForUpload } from '@/lib/image';
import { ImagePlus, Star, Trash2, Loader2 } from 'lucide-react';

interface Photo extends PhotoRef {
  attachment_id: string;
  is_primary: boolean;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
}

export function PhotoGallery({ animalId }: { animalId: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  /** Aviso de que la foto se achicó. No es un error: es para que nadie crea que se perdió algo. */
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_URL}/animals/${animalId}/photos`, { headers: authHeaders() });
    if (res.ok) setPhotos(await res.json());
    setLoading(false);
  }, [animalId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(file: File) {
    setError('');
    setNote('');
    if (!file.type.startsWith('image/')) return setError('El archivo debe ser una imagen.');
    // Ya NO se rechaza por tamaño: una foto de teléfono pesa entre 3 y 12 MB y es lo normal en el
    // campo. Se achica antes de subirla (ver lib/image), así entra igual y encima viaja liviana
    // con mala señal.
    setUploading(true);
    try {
      const img = await prepareImageForUpload(file);
      const res = await fetch(`${API_URL}/animals/${animalId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data_url: img.dataUrl, taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : undefined }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        // La API devuelve `{code, title}`: leer `message.title` daba siempre undefined y el usuario
        // veía el texto genérico en vez del motivo.
        throw new Error(b?.title ?? b?.message?.title ?? 'No se pudo subir la imagen');
      }
      if (img.resized) setNote(`Foto optimizada: ${formatBytes(img.originalBytes)} → ${formatBytes(img.bytes)}`);
      await load();
      router.refresh(); // actualiza la foto principal en la cabecera
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function setPrimary(fileId: string) {
    await fetch(`${API_URL}/animals/${animalId}/photos/${fileId}/primary`, { method: 'POST', headers: authHeaders() });
    await load();
    router.refresh();
  }

  async function remove(fileId: string) {
    await fetch(`${API_URL}/animals/${animalId}/photos/${fileId}`, { method: 'DELETE', headers: authHeaders() });
    await load();
    router.refresh();
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {error && <p className="mb-2 text-label text-danger">{error}</p>}
      {!error && note && <p className="mb-2 text-label text-ink-3">{note}</p>}

      {loading ? (
        <div className="flex justify-center py-8 text-ink-3">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-strong text-ink-3 hover:bg-sunken disabled:opacity-50"
          >
            {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} strokeWidth={1.75} />}
            <span className="text-caption font-medium">{uploading ? 'Subiendo…' : 'Agregar foto'}</span>
          </button>

          {photos.map((p) => (
            <div key={p.attachment_id} className="group relative aspect-square overflow-hidden rounded-md border border-subtle bg-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(p) ?? ''} alt={p.caption ?? 'Foto del animal'} className="size-full object-cover" />
              {p.is_primary && (
                <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-brand px-1.5 py-0.5 text-compat-9 font-semibold text-white">
                  <Star size={9} fill="currentColor" /> Principal
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                {!p.is_primary && (
                  <button
                    title="Marcar como principal"
                    onClick={() => setPrimary(p.file_id)}
                    className="flex size-6 items-center justify-center rounded bg-white/90 text-ink hover:bg-white"
                  >
                    <Star size={13} />
                  </button>
                )}
                <button
                  title="Eliminar"
                  onClick={() => remove(p.file_id)}
                  className="flex size-6 items-center justify-center rounded bg-white/90 text-danger hover:bg-white"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && photos.length === 0 && (
        <p className="mt-2 text-label text-ink-3">
          Sin fotos todavía. La primera que subas será la foto principal de la ficha.
        </p>
      )}
    </div>
  );
}
