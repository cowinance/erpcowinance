import Link from 'next/link';

/** Marco visual compartido de las páginas de auth públicas (P1.3.4). Solo
 *  presentación — sin lógica de negocio. */
export const inputCls =
  'h-10 w-full rounded-md border border-strong bg-surface px-3 text-input outline-none focus:ring-2 focus:ring-brand placeholder:text-ink-3';

export const primaryBtnCls =
  'inline-flex h-10 w-full items-center justify-center rounded-md bg-brand text-input font-medium text-white hover:opacity-90 disabled:opacity-50';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas py-10">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white">C</div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-body text-ink-3">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Botón primario a ancho completo (link estilizado, navegación client-side). */
export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={primaryBtnCls}>
      {children}
    </Link>
  );
}
