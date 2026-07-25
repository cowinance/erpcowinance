'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Beef,
  Boxes,
  Map,
  CalendarCheck,
  Heart,
  Dna,
  Stethoscope,
  FlaskConical,
  Weight,
  Scale,
  Warehouse,
  Baby,
  Milk,
  Wheat,
  Package,
  Sprout,
  Trees,
  CloudSun,
  Tractor,
  Landmark,
  ShoppingCart,
  Store,
  Users,
  ShieldCheck,
  BarChart3,
  Calculator,
  Bell,
  Inbox,
  CreditCard,
  GraduationCap,
  Settings,
  FileText,
  ChevronsUpDown,
  Search,
  Zap,
  LogOut, Receipt } from 'lucide-react';
import { clearSession } from '@/lib/auth';

const SECTIONS: { title: string | null; items: { href: string; label: string; icon: any }[] }[] = [
  {
    title: 'Operación diaria',
    items: [
      { href: '/', label: 'Inicio', icon: LayoutDashboard },
      { href: '/animales', label: 'Animales', icon: Beef },
      { href: '/lotes', label: 'Lotes', icon: Boxes },
      { href: '/manga', label: 'Modo manga', icon: Zap },
      { href: '/mapa', label: 'Potreros y Mapa', icon: Map },
      { href: '/tareas', label: 'Tareas', icon: CalendarCheck },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { href: '/reproduccion', label: 'Reproducción', icon: Heart },
      { href: '/genetica', label: 'Genética', icon: Dna },
      { href: '/sanidad', label: 'Sanidad', icon: Stethoscope },
      { href: '/laboratorio', label: 'Laboratorio', icon: FlaskConical },
      { href: '/produccion', label: 'Producción', icon: Weight },
      { href: '/tambo', label: 'Tambo', icon: Milk },
      { href: '/engorde', label: 'Engorde', icon: Warehouse },
      { href: '/cria', label: 'Cría y recría', icon: Baby },
      { href: '/faena', label: 'Faena', icon: Scale },
      { href: '/nutricion', label: 'Nutrición', icon: Wheat },
      { href: '/agricultura', label: 'Agricultura', icon: Sprout },
      { href: '/pastoreo', label: 'Pastoreo', icon: Trees },
      { href: '/clima', label: 'Clima', icon: CloudSun },
      { href: '/inventario', label: 'Inventario', icon: Package },
      { href: '/maquinaria', label: 'Maquinaria', icon: Tractor },
    ],
  },
  {
    title: 'Negocio',
    items: [
      { href: '/finanzas', label: 'Finanzas', icon: Landmark },
      { href: '/comercial', label: 'Compras y Ventas', icon: ShoppingCart },
      { href: '/costos', label: 'Costos', icon: Calculator },
      { href: '/facturacion', label: 'Facturación', icon: Receipt },
      { href: '/rrhh', label: 'Personal', icon: Users },
      { href: '/modulo/marketplace', label: 'Marketplace', icon: Store },
      { href: '/trazabilidad', label: 'Trazabilidad', icon: ShieldCheck },
      { href: '/reportes', label: 'Reportes', icon: BarChart3 },
    ],
  },
];

const FOOTER_ITEMS = [
  { href: '/notificaciones', label: 'Notificaciones', icon: Inbox },
  { href: '/alertas', label: 'Alertas', icon: Bell },
  { href: '/documentos', label: 'Documentos', icon: FileText },
  { href: '/modulo/academia', label: 'Academia', icon: GraduationCap },
  { href: '/suscripcion', label: 'Plan y suscripción', icon: CreditCard },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
];

/**
 * href → bandera de módulo (FeatureFlagsService.FLAG_REGISTRY). Un módulo sin entrada acá es SIEMPRE
 * visible (core operativo). Los que están se ocultan si su bandera está apagada para el tenant.
 */
const MODULE_FLAG: Record<string, string> = {
  '/tambo': 'module_dairy',
  '/engorde': 'module_feedlot',
  '/cria': 'module_breeding',
  '/faena': 'module_slaughter',
  '/genetica': 'module_genetics',
  '/laboratorio': 'module_lab',
  '/agricultura': 'module_agriculture',
  '/pastoreo': 'module_grazing',
  '/clima': 'module_weather',
  '/maquinaria': 'module_machinery',
  '/trazabilidad': 'module_traceability',
  '/modulo/marketplace': 'module_marketplace',
  '/modulo/academia': 'module_academy',
};

function NavItem({
  href,
  label,
  icon: Icon,
  badge,
  badgeTone,
  badgeAriaLabel,
}: {
  href: string;
  label: string;
  icon: any;
  badge?: number;
  badgeTone?: 'danger' | 'warning';
  /** Sustantivo para el aria-label del badge (p. ej. «notificaciones no leídas»); el número real siempre se anuncia aunque el visual sea 99+. */
  badgeAriaLabel?: string;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-body transition-colors duration-75 ${
        active ? 'bg-brand-soft font-medium text-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink'
      }`}
    >
      <Icon size={18} strokeWidth={1.75} className={active ? 'text-brand' : ''} />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span
          aria-live="polite"
          aria-label={badgeAriaLabel ? `${badge} ${badgeAriaLabel}` : undefined}
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-compat-10 font-semibold text-white ${
            badgeTone === 'danger' ? 'bg-danger' : 'bg-warning'
          }`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  orgName,
  farmName,
  userName,
  openAlerts = 0,
  criticalAlerts = 0,
  unreadNotifications = 0,
  moduleFlags = {},
  variant = 'fixed',
}: {
  orgName?: string;
  farmName?: string;
  userName?: string;
  openAlerts?: number;
  criticalAlerts?: number;
  unreadNotifications?: number;
  /** Estado de las banderas de módulo (key→enabled). Un módulo con bandera apagada se oculta. */
  moduleFlags?: Record<string, boolean>;
  /**
   * `fixed` = columna de escritorio (oculta bajo lg). `drawer` = el MISMO menú dentro del cajón
   * móvil, visible a cualquier ancho porque lo muestra u oculta el cajón que lo contiene.
   *
   * Se reutiliza este componente en vez de escribir una navegación móvil aparte: son 30 secciones
   * con sus banderas de módulo y sus badges, y dos listas separadas se desincronizan al primer
   * módulo nuevo que alguien agregue en una sola.
   */
  variant?: 'fixed' | 'drawer';
}) {
  const visible = (href: string) => {
    const flag = MODULE_FLAG[href];
    return !flag || moduleFlags[flag] !== false;
  };
  const farm = farmName ?? 'Cowinance';
  const initials = farm
    .split(' ')
    .filter((w) => w.length > 2)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <aside
      className={
        variant === 'drawer'
          ? 'flex h-full w-full flex-col overflow-y-auto bg-sunken px-3 pt-4 pb-3'
          : 'sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-sunken px-3 pt-4 pb-3 max-lg:hidden'
      }
    >
      {/* Cabecera de contexto: Organización → Finca */}
      <button className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-brand-soft">
        <div className="flex size-7 items-center justify-center rounded-md bg-brand text-label font-semibold text-white">
          {initials || 'CW'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold">{farm}</div>
          <div className="truncate text-caption text-ink-3">{orgName ?? '—'}</div>
        </div>
        <ChevronsUpDown size={14} className="text-ink-3" />
      </button>

      {/* Buscador global (command palette ⌘K, próximamente) */}
      <button className="mt-3 flex h-8 items-center gap-2 rounded-md border border-subtle bg-surface px-2.5 text-body text-ink-3">
        <Search size={15} strokeWidth={1.75} />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="rounded border border-subtle bg-sunken px-1 font-mono text-compat-10">⌘K</kbd>
      </button>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto">
        {SECTIONS.map((s) => {
          const items = s.items.filter((it) => visible(it.href));
          if (items.length === 0) return null;
          return (
            <div key={s.title}>
              {s.title && (
                <div className="mb-1 px-2.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  {s.title}
                </div>
              )}
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavItem key={it.href} {...it} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-subtle pt-3">
        {FOOTER_ITEMS.filter((it) => visible(it.href)).map((it) =>
          it.href === '/notificaciones' ? (
            <NavItem key={it.href} {...it} badge={unreadNotifications} badgeTone="warning" badgeAriaLabel="notificaciones no leídas" />
          ) : (
            <NavItem
              key={it.href}
              {...it}
              badge={it.href === '/alertas' ? openAlerts : undefined}
              badgeTone={it.href === '/alertas' && criticalAlerts > 0 ? 'danger' : 'warning'}
            />
          ),
        )}
        <button
          onClick={async () => {
            // Un solo lugar cierra sesión (`clearSession`): borra las cookies Y revoca el refresh
            // en el backend. Antes esto se hacía acá a mano leyendo `document.cookie`, que con
            // cookies HttpOnly ya no es posible — ni deseable.
            await clearSession();
            window.location.href = '/login';
          }}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-body text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <LogOut size={18} strokeWidth={1.75} />
          <span className="truncate">Cerrar sesión{userName ? ` (${userName.split(' ')[0]})` : ''}</span>
        </button>
        {/* Indicador de sincronización: información de primera clase (doc §3.1) */}
        <Link
          href="/sincronizacion"
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-label text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          Sincronizado
        </Link>
      </div>
    </aside>
  );
}
