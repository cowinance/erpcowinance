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
  Weight,
  Scale,
  Wheat,
  Package,
  Sprout,
  Tractor,
  Landmark,
  ShoppingCart,
  Store,
  Users,
  ShieldCheck,
  BarChart3,
  Bell,
  Inbox,
  CreditCard,
  GraduationCap,
  Settings,
  ChevronsUpDown,
  Search,
  Zap,
  LogOut,
} from 'lucide-react';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from '@/lib/api';

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
      { href: '/produccion', label: 'Producción', icon: Weight },
      { href: '/faena', label: 'Faena', icon: Scale },
      { href: '/nutricion', label: 'Nutrición', icon: Wheat },
      { href: '/agricultura', label: 'Agricultura', icon: Sprout },
      { href: '/inventario', label: 'Inventario', icon: Package },
      { href: '/maquinaria', label: 'Maquinaria', icon: Tractor },
    ],
  },
  {
    title: 'Negocio',
    items: [
      { href: '/finanzas', label: 'Finanzas', icon: Landmark },
      { href: '/comercial', label: 'Compras y Ventas', icon: ShoppingCart },
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
  { href: '/modulo/academia', label: 'Academia', icon: GraduationCap },
  { href: '/suscripcion', label: 'Plan y suscripción', icon: CreditCard },
  { href: '/modulo/configuracion', label: 'Configuración', icon: Settings },
];

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
}: {
  orgName?: string;
  farmName?: string;
  userName?: string;
  openAlerts?: number;
  criticalAlerts?: number;
  unreadNotifications?: number;
}) {
  const farm = farmName ?? 'Cowinance';
  const initials = farm
    .split(' ')
    .filter((w) => w.length > 2)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-sunken px-3 pt-4 pb-3 max-lg:hidden">
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
        {SECTIONS.map((s) => (
          <div key={s.title}>
            {s.title && (
              <div className="mb-1 px-2.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                {s.title}
              </div>
            )}
            <div className="space-y-0.5">
              {s.items.map((it) => (
                <NavItem key={it.href} {...it} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-subtle pt-3">
        {FOOTER_ITEMS.map((it) =>
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
          onClick={() => {
            const refresh = document.cookie.match(new RegExp(`(?:^|; )${REFRESH_COOKIE}=([^;]*)`))?.[1];
            fetch(`${API_URL}/auth/logout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refresh ? decodeURIComponent(refresh) : undefined }),
            }).catch(() => {});
            document.cookie = `${ACCESS_COOKIE}=; path=/; max-age=0`;
            document.cookie = `${REFRESH_COOKIE}=; path=/; max-age=0`;
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
