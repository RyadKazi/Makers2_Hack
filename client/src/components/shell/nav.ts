import { Accessibility, LayoutGrid, Map, MessagesSquare, MoreHorizontal, Navigation, Palette, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';

export type NavItem = { to: string; labelKey: string; icon: LucideIcon };

/** Primary sections: sidebar, rail and mobile tab bar. */
export const PRIMARY: readonly NavItem[] = [
  { to: '/map', labelKey: 'nav.map', icon: Map },
  { to: '/rooms', labelKey: 'nav.rooms', icon: LayoutGrid },
  { to: '/navigate', labelKey: 'nav.navigate', icon: Navigation },
  { to: '/talk', labelKey: 'nav.talk', icon: MessagesSquare },
];

export const PERSONAL: readonly NavItem[] = [
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
  { to: '/profile', labelKey: 'nav.profile', icon: Accessibility },
  { to: '/design-system', labelKey: 'nav.designSystem', icon: Palette },
];

/** Mobile tab bar: the four primary sections + More. */
export const TABS: readonly NavItem[] = [...PRIMARY, { to: '/more', labelKey: 'nav.more', icon: MoreHorizontal }];

/**
 * For Dr (Teacher), Club, and Admin roles, "Itinéraire" (navigate) and "Parler" (talk)
 * are excluded from the main navigation.
 */
export function getNavItemsForRole(role?: string | null): { primary: readonly NavItem[]; tabs: readonly NavItem[] } {
  const hideNavAndTalk = role === 'TEACHER' || role === 'CLUB' || role === 'ADMIN';
  const isAdmin = role === 'ADMIN';

  const primary = hideNavAndTalk
    ? PRIMARY.filter((item) => item.to !== '/navigate' && item.to !== '/talk')
    : [...PRIMARY];

  if (isAdmin && !primary.some((i) => i.to === '/admin')) {
    primary.push({ to: '/admin', labelKey: 'nav.admin', icon: ShieldCheck });
  }

  const tabs = [...primary, { to: '/more', labelKey: 'nav.more', icon: MoreHorizontal }];
  return { primary, tabs };
}
