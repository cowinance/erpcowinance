'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimalPicker, PickedAnimal, SubmitFeedback, Tabs, inputCls, labelCls, useSubmit } from '@/components/capture';
import { AddProductForm } from './AddProductForm';
import { Plus } from 'lucide-react';

export function SanidadCapture({ products }: { products: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('Vacunación');
  const [animal, setAnimal] = useState<PickedAnimal | null>(null);
  const [productId, setProductId] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const { state, message, submit } = useSubmit();

  const vaccines = products.filter((p) => p.type === 'vaccine');
  const drugs = products.filter((p) => p.type !== 'vaccine');

  function changeTab(t: string) {
    setTab(t);
    setProductId('');
    setAddingProduct(false);
  }

  // Alta inline: al crear un medicamento, se selecciona y se refresca el catálogo
  function onProductCreated(product: any) {
    setProductId(product.id);
    setAddingProduct(false);
    router.refresh();
  }

  const ProductPicker = ({ options, label, defaultType }: { options: any[]; label: string; defaultType: string }) => (
    <div>
      <div className="flex items-center justify-between">
        <span className={labelCls}>{label} *</span>
        <button
          type="button"
          onClick={() => setAddingProduct((v) => !v)}
          className="inline-flex items-center gap-1 text-caption font-medium text-brand hover:underline"
        >
          <Plus size={12} /> Nuevo medicamento
        </button>
      </div>
      <select name="product_id" required value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
        <option value="">Elegir…</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.withdrawal_meat_days ? ` (retiro ${p.withdrawal_meat_days} d)` : ''}
          </option>
        ))}
      </select>
      {addingProduct && (
        <div className="mt-2">
          <AddProductForm defaultType={defaultType} onCreated={onProductCreated} onCancel={() => setAddingProduct(false)} />
        </div>
      )}
    </div>
  );

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!animal) return;
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    let res = null;

    if (tab === 'Vacunación') {
      res = await submit(
        '/vaccinations',
        {
          animal_id: animal.id,
          product_id: fd.get('product_id'),
          dose: fd.get('dose') ? Number(fd.get('dose')) : undefined,
          dose_unit: 'ml',
          batch_number: fd.get('batch_number') || undefined,
          next_due_days: fd.get('next_due_days') ? Number(fd.get('next_due_days')) : undefined,
        },
        () => `Vacunación registrada para ${animal.tag}`,
      );
    } else if (tab === 'Tratamiento') {
      res = await submit(
        '/treatments',
        {
          animal_id: animal.id,
          product_id: fd.get('product_id'),
          dose: fd.get('dose') ? Number(fd.get('dose')) : undefined,
          dose_unit: 'ml',
          route: fd.get('route') || undefined,
          notes: fd.get('notes') || undefined,
        },
        (r) =>
          `Tratamiento registrado para ${animal.tag}${r.meat_withdrawal_until ? ` — retiro de carne hasta ${new Date(r.meat_withdrawal_until).toLocaleDateString('es-AR')}` : ''}`,
      );
    } else if (tab === 'Diagnóstico') {
      res = await submit(
        '/health-events',
        {
          animal_id: animal.id,
          severity: fd.get('severity') || undefined,
          outcome: fd.get('outcome') || 'ongoing',
          notes: fd.get('notes') || undefined,
        },
        () => `Diagnóstico registrado para ${animal.tag}`,
      );
    } else {
      res = await submit(
        '/mortalities',
        { animal_id: animal.id, notes: fd.get('notes') || undefined, estimated_loss: fd.get('estimated_loss') ? Number(fd.get('estimated_loss')) : undefined },
        () => `Baja por muerte registrada para ${animal.tag}`,
      );
    }
    if (res) {
      form.reset();
      setAnimal(null);
      setProductId('');
      router.refresh();
    }
  }

  return (
    <form onSubmit={handle}>
      <Tabs tabs={['Vacunación', 'Tratamiento', 'Diagnóstico', 'Mortalidad']} active={tab} onChange={changeTab} />
      <div className="space-y-3">
        <div>
          <span className={labelCls}>Animal *</span>
          <AnimalPicker animal={animal} onSelect={setAnimal} />
        </div>

        {tab === 'Vacunación' && (
          <>
            <ProductPicker options={vaccines} label="Vacuna" defaultType="vaccine" />
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className={labelCls}>Dosis (ml)</span>
                <input name="dose" type="number" step="0.5" className={inputCls} placeholder="2" />
              </label>
              <label className="block">
                <span className={labelCls}>Lote del frasco</span>
                <input name="batch_number" className={inputCls} placeholder="AF-2026-…" />
              </label>
              <label className="block">
                <span className={labelCls}>Refuerzo (días)</span>
                <input name="next_due_days" type="number" className={inputCls} placeholder="180" />
              </label>
            </div>
          </>
        )}

        {tab === 'Tratamiento' && (
          <>
            <ProductPicker options={drugs} label="Producto" defaultType="antibiotic" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Dosis (ml)</span>
                <input name="dose" type="number" step="0.5" className={inputCls} placeholder="10" />
              </label>
              <label className="block">
                <span className={labelCls}>Vía</span>
                <select name="route" className={inputCls} defaultValue="sc">
                  <option value="sc">Subcutánea</option>
                  <option value="im">Intramuscular</option>
                  <option value="iv">Intravenosa</option>
                  <option value="oral">Oral</option>
                  <option value="topical">Tópica</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>Notas</span>
              <input name="notes" className={inputCls} placeholder="Motivo, observaciones…" />
            </label>
          </>
        )}

        {tab === 'Diagnóstico' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Severidad</span>
                <select name="severity" className={inputCls} defaultValue="mild">
                  <option value="mild">Leve</option>
                  <option value="moderate">Moderada</option>
                  <option value="severe">Severa</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Desenlace</span>
                <select name="outcome" className={inputCls} defaultValue="ongoing">
                  <option value="ongoing">En curso</option>
                  <option value="recovered">Recuperado</option>
                  <option value="referred">Derivado</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>Notas</span>
              <input name="notes" className={inputCls} placeholder="Síntomas, diagnóstico presuntivo…" />
            </label>
          </>
        )}

        {tab === 'Mortalidad' && (
          <>
            <label className="block">
              <span className={labelCls}>Causa</span>
              <input name="notes" className={inputCls} placeholder="Causa probable de muerte…" />
            </label>
            <label className="block">
              <span className={labelCls}>Pérdida estimada ($)</span>
              <input name="estimated_loss" type="number" className={inputCls} placeholder="45000" />
            </label>
            <p className="text-label text-warning">El animal quedará dado de baja (estado: muerto). El historial se conserva.</p>
          </>
        )}

        <SubmitFeedback state={state} message={message} />
        <button
          type="submit"
          disabled={!animal || state === 'saving'}
          className="h-9 w-full rounded-md bg-brand text-body font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {state === 'saving' ? 'Guardando…' : `Registrar ${tab.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
