import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ImportWizard } from './ImportWizard';

/**
 * Importación masiva de animales (P2 P-e). Cáscara del asistente de 5 pasos —
 * subir → mapear → previsualizar → confirmar → resultado— sobre los endpoints
 * `/imports` ya existentes. P-e.1 implementa solo el paso «Subir»; el resto
 * llega en P-e.2…P-e.5.
 */
export default function ImportAnimalsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>
      <h1 className="text-xl font-semibold">Importar animales</h1>
      <p className="mt-0.5 mb-6 text-body text-ink-3">
        Cargá un CSV para dar de alta animales en lote. Vas a poder mapear las columnas, previsualizar y confirmar antes de crear nada.
      </p>
      <ImportWizard />
    </div>
  );
}
