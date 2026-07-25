'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Species { id: string; code: string; name: string; gestation_days: number | null }
interface Breed { id: string; code: string; name: string; purpose: string | null; species_id: string; species_name?: string; editable: boolean }
interface Category { id: string; code: string; name: string; sex: string | null; min_age_months: number | null; max_age_months: number | null }
interface Unit { code: string; name: string; dimension: string; si_factor: number }
interface Diagnosis { id: string; code: string; name: string; category: string | null; is_notifiable: boolean; editable: boolean }
interface Catalogs { species: Species[]; breeds: Breed[]; categories: Category[]; units: Unit[]; diagnoses: Diagnosis[] }
interface Currency { code: string; name: string; symbol: string }
interface CurrencySettings { default_currency: string | null; companies: { id: string; name: string; functional_currency: string }[]; currencies: Currency[] }
interface OrgParams { country_code: string; default_currency: string; default_locale: string; timezone: string; unit_system: string; data_region: string }
interface Flag { key: string; label: string; description: string; enabled: boolean }
interface Rule { code: string; name: string; category: string; severity: string; is_active: boolean; days: number | null; param_label: string | null; default_days: number | null }

const PURPOSES: [string, string][] = [['beef', 'Carne'], ['dairy', 'Leche'], ['dual', 'Doble'], ['wool', 'Lana'], ['work', 'Trabajo']];
const PURPOSE_ES = Object.fromEntries(PURPOSES) as Record<string, string>;
const TABS = ['Moneda', 'Parámetros', 'Funciones', 'Reglas', 'Razas', 'Diagnósticos', 'Categorías', 'Unidades', 'Especies'] as const;

export function ConfigView({ catalogs, currency, params, flags, rules }: { catalogs: Catalogs; currency: CurrencySettings | null; params: OrgParams | null; flags: Flag[]; rules: Rule[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Moneda');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(method: string, path: string, data?: any): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <nav className="tab-strip flex gap-1 border-b border-subtle">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(''); }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium ${tab === t ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      {tab === 'Moneda' && <CurrencyTab currency={currency} busy={busy} call={call} />}
      {tab === 'Parámetros' && <ParamsTab params={params} busy={busy} call={call} />}
      {tab === 'Funciones' && <FlagsTab flags={flags} busy={busy} call={call} />}
      {tab === 'Reglas' && <RulesTab rules={rules} busy={busy} call={call} />}
      {tab === 'Razas' && <BreedsTab catalogs={catalogs} busy={busy} call={call} />}
      {tab === 'Diagnósticos' && <DiagnosesTab diagnoses={catalogs.diagnoses} busy={busy} call={call} />}
      {tab === 'Categorías' && <CategoriesTab categories={catalogs.categories} />}
      {tab === 'Unidades' && <UnitsTab units={catalogs.units} />}
      {tab === 'Especies' && <SpeciesTab species={catalogs.species} />}
    </div>
  );
}

type Call = (method: string, path: string, data?: any) => Promise<boolean>;

function CurrencyTab({ currency, busy, call }: { currency: CurrencySettings | null; busy: boolean; call: Call }) {
  const [code, setCode] = useState(currency?.default_currency ?? '');
  if (!currency) return <Card><p className="py-3 text-center text-label text-ink-3">No se pudo cargar la configuración de moneda.</p></Card>;
  const current = currency.currencies.find((c) => c.code === currency.default_currency);
  const changed = code !== currency.default_currency;

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Moneda de la finca</CardTitle>
        <p className="mb-3 text-label text-ink-3">
          Moneda operativa actual: <span className="font-medium text-ink-1">{current ? `${current.name} (${current.code})` : currency.default_currency ?? '—'}</span>
        </p>
        <div className="space-y-2">
          <Select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Moneda">
            {currency.currencies.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </Select>
          <Button size="sm" fullWidth loading={busy} disabled={busy || !changed} onClick={() => call('PUT', '/config/currency', { code })}>
            Guardar moneda
          </Button>
          <p className="text-caption text-ink-3">Aplica a la organización y a sus empresas. Los documentos ya emitidos conservan su moneda original.</p>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle>Empresas</CardTitle>
        <ul className="divide-y divide-subtle">
          {currency.companies.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-body">
              <span className="font-medium">{c.name}</span>
              <span className="tnum text-label text-ink-3">{c.functional_currency}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ParamsTab({ params, busy, call }: { params: OrgParams | null; busy: boolean; call: Call }) {
  const [unitSystem, setUnitSystem] = useState(params?.unit_system ?? 'metric');
  const [locale, setLocale] = useState(params?.default_locale ?? '');
  const [timezone, setTimezone] = useState(params?.timezone ?? '');
  if (!params) return <Card><p className="py-3 text-center text-label text-ink-3">No se pudieron cargar los parámetros.</p></Card>;

  return (
    <Card className="max-w-lg">
      <CardTitle>Parámetros de la organización</CardTitle>
      <p className="mb-3 text-label text-ink-3">País {params.country_code} · región {params.data_region}. Estos ajustes definen cómo se formatean fechas, números y unidades en toda la app.</p>
      <div className="space-y-3">
        <label className="block text-label text-ink-2">Sistema de unidades
          <div className="mt-1"><Select value={unitSystem} onChange={(e) => setUnitSystem(e.target.value)} aria-label="Sistema de unidades">
            <option value="metric">Métrico (kg, km, ha)</option>
            <option value="imperial">Imperial (lb, mi, ac)</option>
          </Select></div>
        </label>
        <label className="block text-label text-ink-2">Locale
          <div className="mt-1"><Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="es-AR" aria-label="Locale" /></div>
        </label>
        <label className="block text-label text-ink-2">Zona horaria
          <div className="mt-1"><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Argentina/Buenos_Aires" aria-label="Zona horaria" /></div>
        </label>
        <Button size="sm" loading={busy} disabled={busy || !locale.trim() || !timezone.trim()} onClick={() => call('PUT', '/config/params', { unit_system: unitSystem, default_locale: locale, timezone })}>
          Guardar parámetros
        </Button>
      </div>
    </Card>
  );
}

function FlagsTab({ flags, busy, call }: { flags: Flag[]; busy: boolean; call: Call }) {
  return (
    <Card className="max-w-2xl">
      <CardTitle>Módulos de la finca</CardTitle>
      <p className="mb-3 text-label text-ink-3">Activá o desactivá módulos según lo que usa tu finca. Los módulos apagados se ocultan del menú lateral.</p>
      <ul className="divide-y divide-subtle">
        {flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-body font-medium">{f.label}</div>
              <div className="text-label text-ink-3">{f.description}</div>
            </div>
            <button
              role="switch"
              aria-checked={f.enabled}
              aria-label={f.label}
              disabled={busy}
              onClick={() => call('PUT', '/config/feature-flags', { key: f.key, enabled: !f.enabled })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${f.enabled ? 'bg-brand' : 'bg-sunken border border-subtle'}`}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${f.enabled ? 'left-4' : 'left-0.5'}`} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const CATEGORY_ES: Record<string, string> = { health: 'Sanidad', reproduction: 'Reproducción', task: 'Operación', inventory: 'Inventario', finance: 'Finanzas', iot: 'IoT' };
const SEVERITY_ES: Record<string, string> = { info: 'Info', warning: 'Atención', critical: 'Crítico' };

function RulesTab({ rules, busy, call }: { rules: Rule[]; busy: boolean; call: Call }) {
  return (
    <Card className="max-w-3xl">
      <CardTitle>Reglas de alerta</CardTitle>
      <p className="mb-3 text-label text-ink-3">Activá o desactivá cada regla y ajustá su umbral (ventana de anticipación). El motor de alertas usa esta configuración.</p>
      <ul className="divide-y divide-subtle">
        {rules.map((r) => <RuleRow key={r.code} rule={r} busy={busy} call={call} />)}
      </ul>
    </Card>
  );
}

function RuleRow({ rule, busy, call }: { rule: Rule; busy: boolean; call: Call }) {
  const [days, setDays] = useState(rule.days != null ? String(rule.days) : '');
  const changed = rule.days != null && String(rule.days) !== days;
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-body font-medium">{rule.name}</div>
        <div className="text-label text-ink-3">{CATEGORY_ES[rule.category] ?? rule.category} · {SEVERITY_ES[rule.severity] ?? rule.severity}</div>
      </div>
      <div className="flex items-center gap-3">
        {rule.days != null && (
          <div className="flex items-center gap-1.5">
            <div className="w-16"><Input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} aria-label={`${rule.param_label ?? 'Umbral'} de ${rule.name}`} /></div>
            <span className="text-caption text-ink-3 whitespace-nowrap">{rule.param_label ?? 'días'}</span>
            {changed && (
              <Button size="sm" variant="secondary" loading={busy} disabled={busy || !days.trim()} onClick={() => call('PUT', `/alerts/rules/${rule.code}`, { is_active: rule.is_active, days: Number(days) })}>Guardar</Button>
            )}
          </div>
        )}
        <button
          role="switch"
          aria-checked={rule.is_active}
          aria-label={rule.name}
          disabled={busy}
          onClick={() => call('PUT', `/alerts/rules/${rule.code}`, { is_active: !rule.is_active, days: rule.days ?? undefined })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${rule.is_active ? 'bg-brand' : 'bg-sunken border border-subtle'}`}
        >
          <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${rule.is_active ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>
    </li>
  );
}

function BaseBadge({ editable }: { editable: boolean }) {
  return editable ? <span className="rounded bg-brand-soft px-1.5 py-0.5 text-caption text-brand">Propia</span> : <span className="rounded bg-sunken px-1.5 py-0.5 text-caption text-ink-3">Base</span>;
}

function BreedsTab({ catalogs, busy, call }: { catalogs: Catalogs; busy: boolean; call: Call }) {
  const [speciesId, setSpeciesId] = useState(catalogs.species[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nueva raza</CardTitle>
        <div className="space-y-2">
          <Select value={speciesId} onChange={(e) => setSpeciesId(e.target.value)} aria-label="Especie">
            {catalogs.species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label="Código" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre" />
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Aptitud">
            <option value="">Aptitud (opcional)</option>
            {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Button size="sm" fullWidth loading={busy} disabled={busy || !code.trim() || !name.trim() || !speciesId}
            onClick={() => call('POST', '/config/breeds', { species_id: speciesId, code, name, purpose: purpose || undefined }).then((ok) => { if (ok) { setCode(''); setName(''); setPurpose(''); } })}>
            Agregar raza
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{catalogs.breeds.length}</span>}>Razas</CardTitle>
        <ul className="divide-y divide-subtle">
          {catalogs.breeds.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <span className="text-body font-medium">{b.name}</span>
                <span className="text-label text-ink-3">{b.species_name} · {b.code}{b.purpose ? ` · ${PURPOSE_ES[b.purpose] ?? b.purpose}` : ''}</span>
                <BaseBadge editable={b.editable} />
              </div>
              {b.editable && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('DELETE', `/config/breeds/${b.id}`)} aria-label={`Borrar ${b.name}`}>✕</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function DiagnosesTab({ diagnoses, busy, call }: { diagnoses: Diagnosis[]; busy: boolean; call: Call }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [notifiable, setNotifiable] = useState(false);

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nuevo diagnóstico</CardTitle>
        <div className="space-y-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label="Código" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre" />
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoría (opcional)" aria-label="Categoría" />
          <label className="flex items-center gap-2 text-body text-ink-2">
            <input type="checkbox" checked={notifiable} onChange={(e) => setNotifiable(e.target.checked)} /> De notificación obligatoria
          </label>
          <Button size="sm" fullWidth loading={busy} disabled={busy || !code.trim() || !name.trim()}
            onClick={() => call('POST', '/config/diagnoses', { code, name, category: category || undefined, is_notifiable: notifiable }).then((ok) => { if (ok) { setCode(''); setName(''); setCategory(''); setNotifiable(false); } })}>
            Agregar diagnóstico
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{diagnoses.length}</span>}>Diagnósticos</CardTitle>
        {diagnoses.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin diagnósticos. Agregá los propios de tu finca.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {diagnoses.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span className="text-body font-medium">{d.name}</span>
                  <span className="text-label text-ink-3">{d.code}{d.category ? ` · ${d.category}` : ''}</span>
                  {d.is_notifiable && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption text-warning">Notificable</span>}
                  <BaseBadge editable={d.editable} />
                </div>
                {d.editable && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('DELETE', `/config/diagnoses/${d.id}`)} aria-label={`Borrar ${d.name}`}>✕</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReadOnlyNote() {
  return <p className="mb-3 text-label text-ink-3">Catálogo global de solo lectura.</p>;
}

function CategoriesTab({ categories }: { categories: Category[] }) {
  return (
    <Card>
      <CardTitle action={<span className="text-label text-ink-3">{categories.length}</span>}>Categorías zootécnicas</CardTitle>
      <ReadOnlyNote />
      <ul className="divide-y divide-subtle">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-1.5 text-body">
            <span className="font-medium">{c.name}</span>
            <span className="text-label text-ink-3">{c.code}{c.sex ? ` · ${c.sex}` : ''}{c.min_age_months != null ? ` · ${c.min_age_months}+ m` : ''}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UnitsTab({ units }: { units: Unit[] }) {
  return (
    <Card>
      <CardTitle action={<span className="text-label text-ink-3">{units.length}</span>}>Unidades de medida</CardTitle>
      <ReadOnlyNote />
      <ul className="divide-y divide-subtle">
        {units.map((u) => (
          <li key={u.code} className="flex items-center justify-between py-1.5 text-body">
            <span className="font-medium">{u.name} <span className="text-label text-ink-3">({u.code})</span></span>
            <span className="text-label text-ink-3">{u.dimension} · SI ×{u.si_factor}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SpeciesTab({ species }: { species: Species[] }) {
  return (
    <Card>
      <CardTitle action={<span className="text-label text-ink-3">{species.length}</span>}>Especies</CardTitle>
      <ReadOnlyNote />
      <ul className="divide-y divide-subtle">
        {species.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1.5 text-body">
            <span className="font-medium">{s.name} <span className="text-label text-ink-3">({s.code})</span></span>
            {s.gestation_days != null && <span className="text-label text-ink-3">gestación {s.gestation_days} d</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
