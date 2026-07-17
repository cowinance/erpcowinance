import { HealthReportsView } from './HealthReportsView';

export default function SanidadReportesPage() {
  const today = new Date().toISOString().slice(0, 10);
  return <HealthReportsView today={today} />;
}
