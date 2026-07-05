import { apiSafe } from '@/lib/api';
import { NewAnimalForm } from './NewAnimalForm';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function NewAnimalPage() {
  const [categories, lots] = await Promise.all([apiSafe<any[]>('/catalogs/categories'), apiSafe<any[]>('/lots')]);

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>
      <h1 className="text-xl font-semibold">Nuevo animal</h1>
      <p className="mt-0.5 mb-6 text-[13px] text-ink-3">
        Alta manual — el alta por nacimiento, compra o importación masiva llega con el resto del módulo Hato.
      </p>
      <NewAnimalForm categories={categories ?? []} lots={lots ?? []} />
    </div>
  );
}
