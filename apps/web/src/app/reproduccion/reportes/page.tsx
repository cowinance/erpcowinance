import { ReproReportsView } from './ReproReportsView';

export default function ReproReportesPage() {
  const today = new Date().toISOString().slice(0, 10);
  return <ReproReportsView today={today} />;
}
