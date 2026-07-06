import { ReportsView } from './ReportsView';

export default function ReportesPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Reportes</h1>
      <p className="mt-0.5 mb-5 text-[13px] text-ink-3">
        Reportes esenciales reconstruidos por eventos · exportables a CSV
      </p>
      <ReportsView />
    </div>
  );
}
