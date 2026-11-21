/**
 * Responsive shell (DESIGN_REFERENCE §3):
 *   ≥ 1200 px  sidebar 240 px (collapsible to 72 px) + top bar + main + optional 400 px right panel
 *   768–1199   72 px icon rail + navigation drawer; right panel as an overlay drawer
 *   < 768      compact top bar + bottom tab bar; right panel as a bottom sheet
 * All sides are logical (start / end), so Arabic mirrors the layout.
 */
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useFocusTrap, useInertBackground } from '@/a11y/focus';
import { IconButton } from '@/components/ui/Button';
import { BottomSheet, type Snap } from '@/components/ui/BottomSheet';
import { SidePanel } from '@/components/ui/SidePanel';
import { cn } from '@/lib/cn';
import { useTier } from '@/lib/hooks';
import { usePreferences } from '@/stores/preferences';
import { createPortal } from 'react-dom';
import { CommandPalette } from './CommandPalette';
import { FloorSelect, LanguageSelect, ProfileMenu, ThemeButton } from './Controls';
import { Logo } from './Logo';
import { PERSONAL, getNavItemsForRole, type NavItem } from './nav';
import { useAuth } from '@/stores/auth';
import { RightPanelProvider, useRightPanel } from './RightPanel';
import { SkipLink } from './Page';

function NavLinks({ items, collapsed, onNavigate }: { items: readonly NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ to, labelKey, icon: Icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            onClick={onNavigate}
            aria-label={collapsed ? t(labelKey) : undefined}
            title={collapsed ? t(labelKey) : undefined}
            className={({ isActive }) =>
              cn(
                'group flex min-h-12 items-center gap-3 rounded-control border-s-[3px] text-sm font-bold transition-all duration-fast',
                collapsed ? 'justify-center px-0' : 'px-3.5',
                isActive
                  ? 'border-primary bg-primary-50 text-primary font-black hc:bg-primary hc:text-on-primary'
                  : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink active:scale-[0.98]',
              )
            }
          >
            <Icon aria-hidden className="size-5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
            {collapsed ? null : <span className="min-w-0 break-words">{t(labelKey)}</span>}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SectionTitle({ children, hidden }: { children: string; hidden?: boolean }) {
  return <h2 className={cn('px-3 pb-1 pt-3 text-sm font-bold uppercase tracking-wider text-muted', hidden && 'sr-only')}>{children}</h2>;
}

function Sidebar() {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.role);
  const { primary } = getNavItemsForRole(role);
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggle = usePreferences((s) => s.toggleSidebar);
  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col border-e border-line bg-card px-3 py-3 hc:border-e-2 hc:border-white',
        collapsed ? 'w-rail' : 'w-sidebar',
      )}
    >
      <div className={cn('flex min-h-12 items-center', collapsed ? 'justify-center' : 'px-2')}>
        <Logo collapsed={collapsed} />
      </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <SectionTitle hidden={collapsed}>{t('nav.sectionCampus')}</SectionTitle>
          <NavLinks items={primary} collapsed={collapsed} />
          <SectionTitle hidden={collapsed}>{t('nav.sectionYou')}</SectionTitle>
          <NavLinks items={PERSONAL} collapsed={collapsed} />
        </div>
        <div className={cn('pt-2', collapsed && 'flex justify-center')}>
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} flipRtl label={collapsed ? t('nav.expand') : t('nav.collapse')} aria-expanded={!collapsed} onClick={toggle} />
        </div>
    </nav>
  );
}

function Rail({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.role);
  const { primary } = getNavItemsForRole(role);
  return (
    <nav aria-label={t('nav.main')} className="sticky top-0 flex h-dvh w-rail shrink-0 flex-col items-center gap-1 border-e border-line bg-card py-3 hc:border-e-2 hc:border-white">
      <IconButton icon={Menu} label={t('nav.menu')} onClick={onMenu} />
      <ul className="mt-2 flex w-full flex-col gap-1 px-1.5">
        {primary.map(({ to, labelKey, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn('flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border-s-[3px] px-1 text-center text-sm font-bold', isActive ? 'border-primary bg-primary-50 text-primary hc:bg-primary hc:text-on-primary' : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink')
              }
            >
              <Icon aria-hidden className="size-6" />
              <span className="break-words leading-tight">{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.role);
  const { primary } = getNavItemsForRole(role);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, { onEscape: onClose });
  useInertBackground(open);
  if (!open) return null;
  return createPortal(
    <>
      <div aria-hidden className="fixed inset-0 z-overlay bg-ink/40 hc:bg-black/80" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('nav.menu')} className="fixed inset-y-0 start-0 z-overlay flex w-[min(20rem,85vw)] flex-col border-e border-line bg-card p-3 shadow-float hc:border-e-2 hc:border-white">
        <div className="flex items-center justify-between ps-2">
          <Logo />
          <IconButton icon={X} label={t('nav.close')} onClick={onClose} />
        </div>
        <nav aria-label={t('nav.main')} className="min-h-0 flex-1 overflow-y-auto">
          <SectionTitle>{t('nav.sectionCampus')}</SectionTitle>
          <NavLinks items={primary} onNavigate={onClose} />
          <SectionTitle>{t('nav.sectionYou')}</SectionTitle>
          <NavLinks items={PERSONAL} onNavigate={onClose} />
        </nav>
      </div>
    </>,
    document.body,
  );
}

function BottomTabBar() {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.role);
  const { tabs } = getNavItemsForRole(role);
  return (
    <nav aria-label={t('nav.tabs')} className="fixed inset-x-3 bottom-3 z-bar mx-auto max-w-md pb-safe">
      <div className="floating-dock rounded-card p-1.5 shadow-float hc:border-2 hc:border-white hc:bg-black">
        <ul className={cn('grid items-center gap-1', tabs.length === 5 ? 'grid-cols-5' : tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-4')}>
          {tabs.map(({ to, labelKey, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-control border-s-[3px] px-1.5 py-1.5 text-center text-sm font-bold transition-all duration-fast',
                    isActive
                      ? 'border-primary bg-primary-50 text-primary font-black hc:bg-primary hc:text-on-primary'
                      : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink active:scale-95',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon aria-hidden className={cn('size-5 transition-transform duration-200', isActive && 'scale-110')} />
                    <span className="break-words leading-tight text-sm max-w-[64px] truncate">{t(labelKey)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function TopBar({ tier, onSearch }: { tier: 'mobile' | 'tablet' | 'desktop'; onSearch: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-bar flex min-h-16 flex-wrap items-center gap-2 border-b border-line bg-card px-3 shadow-card hc:border-b-2 hc:border-white hc:bg-black tablet:px-6">
      {tier === 'mobile' ? (
        <span className="me-auto">
          <Logo />
        </span>
      ) : (
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts="Control+K"
          className="group me-auto flex min-h-12 w-full max-w-sm items-center gap-3 rounded-control border border-control bg-surface-2 px-4 text-start text-sm text-muted shadow-card hover:border-primary transition-colors duration-fast"
        >
          <Search aria-hidden className="size-4 text-muted group-hover:text-primary transition-colors" />
          <span className="flex-1 text-ink/80 font-medium">{t('topbar.search')}</span>
          <kbd className="rounded-lg border border-line bg-card px-2 py-0.5 text-sm font-bold text-muted shadow-card">
            {t('topbar.searchShortcut')}
          </kbd>
        </button>
      )}
      {tier === 'mobile' ? (
        <div className="flex items-center gap-1 ms-auto">
          <IconButton icon={Search} label={t('topbar.search')} onClick={onSearch} />
          <ThemeButton />
          <ProfileMenu />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <FloorSelect />
          {tier === 'desktop' ? <LanguageSelect /> : null}
          <ThemeButton />
          <ProfileMenu />
        </div>
      )}
    </header>
  );
}

function PanelHost({ tier }: { tier: 'mobile' | 'tablet' | 'desktop' }) {
  const { panel, close } = useRightPanel();
  const [snap, setSnap] = useState<Snap>('half');
  if (!panel) return null;
  if (tier === 'mobile') {
    return (
      <BottomSheet open title={panel.title} snap={snap} onSnapChange={setSnap} modal onClose={close} footer={panel.footer}>
        {panel.body}
      </BottomSheet>
    );
  }
  return (
    <SidePanel open mode={tier === 'desktop' ? 'inline' : 'overlay'} title={panel.title} onClose={close} footer={panel.footer}>
      {panel.body}
    </SidePanel>
  );
}

function ShellLayout() {
  const tier = useTier();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const { close } = useRightPanel();

  // Close transient UI when the path changes (not on first mount: a page may open the panel from a deep link).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setMenuOpen(false);
    close();
  }, [pathname, close]);

  // Ctrl+K / ⌘K anywhere; "/" when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      {tier === 'desktop' ? <Sidebar /> : null}
      {tier === 'tablet' ? <Rail onMenu={() => setMenuOpen(true)} /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar tier={tier} onSearch={() => setSearchOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <main id="main" tabIndex={-1} className={cn('min-w-0 flex-1 px-4 py-5 tablet:px-6 tablet:py-6', tier === 'mobile' && 'pb-28')}>
            <Outlet />
          </main>
          {tier === 'desktop' ? <PanelHost tier={tier} /> : null}
        </div>
      </div>
      {tier !== 'desktop' ? <PanelHost tier={tier} /> : null}
      {tier === 'mobile' ? <BottomTabBar /> : null}
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export function AppShell() {
  return (
    <RightPanelProvider>
      <ShellLayout />
    </RightPanelProvider>
  );
}

/** Minimal layout for public pages (landing, login, onboarding). */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />
      <header className="relative flex min-h-20 items-center justify-center gap-3 border-b border-line bg-card px-3 shadow-card hc:border-b-2 hc:border-white tablet:px-6">
        {/* One brand lockup only — no separate mark tile alongside the wordmark. */}
        <NavLink to="/" className="flex items-center rounded-control" aria-label={`${t('app.name')} — ${t('common.home')}`}>
          <Logo className="h-10 max-w-24 desk:h-12" />
        </NavLink>
        <div className="absolute end-3 flex items-center gap-1 tablet:end-6">
          <LanguageSelect narrow />
          <ThemeButton />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 tablet:px-6">
        {children}
      </main>
      <footer className="border-t border-line bg-card px-6 py-6 text-center text-sm text-muted">{t('landing.footer')}</footer>
    </div>
  );
}
