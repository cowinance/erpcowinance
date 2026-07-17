import { apiSafe } from '@/lib/server-api';
import { NewAnimalForm } from './NewAnimalForm';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function NewAnimalPage() {
  const [categories, lots, catalogs] = await Promise.all([
    apiSafe<any[]>('/catalogs/categories'),
    apiSafe<any[]>('/lots'),
    apiSafe<any>('/config/catalogs'),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>
      <h1 className="text-xl font-semibold">Nuevo animal</h1>
      <p className="mt-0.5 mb-6 text-body text-ink-3">
        Alta manual — según el origen se registra el evento (nacimiento, compra o transferencia). Para altas
        masivas usá Importar.
      </p>
      <NewAnimalForm categories={categories ?? []} lots={lots ?? []} breeds={catalogs?.breeds ?? []} />
    </div>
  );
}
