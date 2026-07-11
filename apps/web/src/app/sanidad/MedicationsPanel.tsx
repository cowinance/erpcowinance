'use client';

/**
 * Vademécum: catálogo de medicamentos veterinarios del tenant, con alta.
 * Los medicamentos que se agregan acá quedan disponibles para registrar
 * vacunaciones y tratamientos (aparecen en los desplegables de captura).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui';
import { AddProductForm, PRODUCT_TYPES } from './AddProductForm';
import { Plus, Pill } from 'lucide-react';

const TYPE_LABEL = Object.fromEntries(PRODUCT_TYPES);

export function MedicationsPanel({ products }: { products: any[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <Card className="mt-4">
      <CardTitle
        action={
          !adding && (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-label font-medium text-white hover:opacity-90"
            >
              <Plus size={14} /> Agregar medicamento
            </button>
          )
        }
      >
        Vademécum ({products.length})
      </CardTitle>

      {adding && (
        <div className="mb-4">
          <AddProductForm
            onCreated={() => {
              setAdding(false);
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {products.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">
          Sin medicamentos cargados. Agregá el primero para poder registrar vacunas y tratamientos.
        </p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th>Medicamento</th>
              <th>Tipo</th>
              <th>Principio activo</th>
              <th>Dosis por defecto</th>
              <th className="text-right">Retiro carne</th>
              <th className="pr-1 text-right">Retiro leche</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                <td className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    <Pill size={13} className="text-ink-3" /> {p.name}
                  </span>
                </td>
                <td className="text-ink-2">{TYPE_LABEL[p.type] ?? p.type}</td>
                <td className="text-ink-2">{p.active_ingredient ?? '—'}</td>
                <td className="text-ink-2">{p.default_dose ?? '—'}</td>
                <td className="tnum text-right text-ink-2">{p.withdrawal_meat_days != null ? `${p.withdrawal_meat_days} d` : '—'}</td>
                <td className="tnum pr-1 text-right text-ink-2">{p.withdrawal_milk_hours != null ? `${p.withdrawal_milk_hours} h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
