import { AlertsView } from './AlertsView';

export default function AlertasPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Alertas</h1>
      <p className="mt-0.5 mb-5 text-[13px] text-ink-3">
        Motor de reglas · retiros, vacunas, partos, preñeces vencidas y sincronización
      </p>
      <AlertsView />
    </div>
  );
}
