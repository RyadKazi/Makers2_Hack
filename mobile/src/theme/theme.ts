/**
 * accesU / SmartCampus Design System Tokens
 * Source of truth: MOBILE_SPEC.md § 1 (Design Tokens & Styling)
 */

export type ThemeMode = 'system' | 'light' | 'warm' | 'dark' | 'hc';

/**
 * Space-separated RGB triples matching web CSS variables
 */
export const rgbTokens = {
  canvas: {
    light: '248 250 247',
    dark: '30 46 33',
    hc: '0 0 0',
  },
  card: {
    light: '255 255 255',
    dark: '39 60 42',
    hc: '0 0 0',
  },
  surface2: {
    light: '243 248 231',
    dark: '50 76 53',
    hc: '0 0 0',
  },
  ink: {
    light: '38 55 42',
    dark: '243 248 231',
    hc: '255 255 255',
  },
  muted: {
    light: '100 112 100',
    dark: '202 220 188',
    hc: '255 255 255',
  },
  line: {
    light: '228 233 223',
    dark: '71 108 76',
    hc: '255 255 255',
  },
  lineStrong: {
    light: '100 112 100',
    dark: '164 198 164',
    hc: '255 255 255',
  },
  primary: {
    light: '71 108 76',
    dark: '164 198 164',
    hc: '255 214 10',
  },
} as const;

export function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function parseRgb(rgbStr: string, alpha?: number): string {
  const parts = rgbStr.split(/\s+/).map(Number);
  if (parts.length < 3) return rgbStr;
  const [r, g, b] = parts;
  return alpha !== undefined ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
}

export interface ThemeColors {
  /** Page background */
  canvas: string;
  /** Card surface */
  card: string;
  /** Secondary surface (cream) */
  surface2: string;
  /** Primary text */
  ink: string;
  /** Secondary text */
  muted: string;
  /** Border */
  line: string;
  /** Control border */
  lineStrong: string;
  /** Focus ring */
  focus: string;
  /** Primary action (forest) */
  primary: string;
  /** Primary dark */
  primary800: string;
  /** Primary tint */
  primary50: string;
  /** Text on primary */
  onPrimary: string;
  /** Route polyline */
  route: string;
  /** Route text */
  routeText: string;
  /** Route tint */
  route100: string;
  /** Available / free status */
  available: string;
  /** Available fill */
  availableBg: string;
  /** Occupied / danger status */
  occupied: string;
  /** Occupied fill */
  occupiedBg: string;
  /** Club status */
  club: string;
  /** Club fill */
  clubBg: string;
  /** Warning */
  warning: string;
  /** Warning fill */
  warningBg: string;

  /** Static / brand accents */
  forest: string;
  forestHover: string;
  olive: string;
  sage: string;
  soft: string;
  cream: string;

  /** Status bar background color */
  statusBar: string;
  /** Border width (2px in HC) */
  borderWidth: number;

  /** Backward-compatible aliases for existing screens */
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  primaryText: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
  tab: string;
  shadow: string;
  mapRoom: string;
  mapWalkable: string;
  mapBlocked: string;
  mapWall: string;
}

export const lightColors: ThemeColors = {
  canvas: '#F8FAF7',
  card: '#FFFFFF',
  surface2: '#F3F8E7',
  ink: '#26372A',
  muted: '#647064',
  line: '#E4E9DF',
  lineStrong: '#647064',
  focus: '#476C4C',
  primary: '#476C4C',
  primary800: '#324C35',
  primary50: '#F3F8E7',
  onPrimary: '#FFFFFF',
  route: '#476C4C',
  routeText: '#324C35',
  route100: '#F3F8E7',
  available: '#15803D',
  availableBg: '#DCFCE7',
  occupied: '#B91C1C',
  occupiedBg: '#FEE2E2',
  club: '#C2410C',
  clubBg: '#FFEDD5',
  warning: '#B45309',
  warningBg: '#FEF3C7',

  forest: '#476C4C',
  forestHover: '#3C5C40',
  olive: '#7D9B5F',
  sage: '#A4C6A4',
  soft: '#CADCBC',
  cream: '#F3F8E7',

  statusBar: '#476C4C',
  borderWidth: 1,

  // Compatibility aliases
  background: '#F8FAF7',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F8E7',
  text: '#26372A',
  primaryText: '#FFFFFF',
  border: '#E4E9DF',
  accent: '#476C4C',
  accentText: '#FFFFFF',
  danger: '#B91C1C',
  success: '#15803D',
  tab: '#F8FAF7',
  shadow: '#26372A',
  mapRoom: '#E4F2E8',
  mapWalkable: '#15803D',
  mapBlocked: '#B91C1C',
  mapWall: '#26372A',
};

/**
 * Warm Theme (Authoritative default resolution on Web)
 */
export const warmColors: ThemeColors = {
  ...lightColors,
  available: '#10B981',
  availableBg: '#ECFDF5',
  occupied: '#EF4444',
  occupiedBg: '#FEF2F2',
  club: '#D97706',
  clubBg: '#FEF3C7',
  warning: '#D97706',
  warningBg: '#FEF3C7',

  // Compatibility overrides
  success: '#10B981',
  danger: '#EF4444',
  mapWalkable: '#10B981',
  mapBlocked: '#EF4444',
};

export const darkColors: ThemeColors = {
  canvas: '#1E2E21',
  card: '#273C2A',
  surface2: '#324C35',
  ink: '#F3F8E7',
  muted: '#CADCBC',
  line: '#476C4C',
  lineStrong: '#A4C6A4',
  focus: '#A4C6A4',
  primary: '#A4C6A4',
  primary800: '#7D9B5F',
  primary50: '#324C35',
  onPrimary: '#1E2E21',
  route: '#A4C6A4',
  routeText: '#CADCBC',
  route100: '#324C35',
  available: '#4ADE80',
  availableBg: '#0F2E1C',
  occupied: '#FCA5A5',
  occupiedBg: '#3A1214',
  club: '#FDBA74',
  clubBg: '#3A1D0C',
  warning: '#FCD34D',
  warningBg: '#3A2A0A',

  forest: '#476C4C',
  forestHover: '#3C5C40',
  olive: '#7D9B5F',
  sage: '#A4C6A4',
  soft: '#CADCBC',
  cream: '#F3F8E7',

  statusBar: '#1E2E21',
  borderWidth: 1,

  // Compatibility aliases
  background: '#1E2E21',
  surface: '#273C2A',
  surfaceRaised: '#324C35',
  text: '#F3F8E7',
  primaryText: '#1E2E21',
  border: '#476C4C',
  accent: '#A4C6A4',
  accentText: '#1E2E21',
  danger: '#FCA5A5',
  success: '#4ADE80',
  tab: '#1E2E21',
  shadow: '#000000',
  mapRoom: '#273C2A',
  mapWalkable: '#4ADE80',
  mapBlocked: '#FCA5A5',
  mapWall: '#F3F8E7',
};

export const hcColors: ThemeColors = {
  canvas: '#000000',
  card: '#000000',
  surface2: '#000000',
  ink: '#FFFFFF',
  muted: '#FFFFFF',
  line: '#FFFFFF',
  lineStrong: '#FFFFFF',
  focus: '#FFD60A',
  primary: '#FFD60A',
  primary800: '#FFD60A',
  primary50: '#000000',
  onPrimary: '#000000',
  route: '#FFD60A',
  routeText: '#FFD60A',
  route100: '#000000',
  available: '#FFFFFF',
  availableBg: '#000000',
  occupied: '#FFFFFF',
  occupiedBg: '#000000',
  club: '#FFFFFF',
  clubBg: '#000000',
  warning: '#FFD60A',
  warningBg: '#000000',

  forest: '#FFD60A',
  forestHover: '#FFD60A',
  olive: '#FFD60A',
  sage: '#FFD60A',
  soft: '#FFFFFF',
  cream: '#000000',

  statusBar: '#000000',
  borderWidth: 2,

  // Compatibility aliases
  background: '#000000',
  surface: '#000000',
  surfaceRaised: '#000000',
  text: '#FFFFFF',
  primaryText: '#000000',
  border: '#FFFFFF',
  accent: '#FFD60A',
  accentText: '#000000',
  danger: '#FFFFFF',
  success: '#FFFFFF',
  tab: '#000000',
  shadow: 'transparent',
  mapRoom: '#000000',
  mapWalkable: '#FFD60A',
  mapBlocked: '#FFFFFF',
  mapWall: '#FFFFFF',
};

/**
 * Radii per MOBILE_SPEC.md § 1.7
 * lg=8px, xl/control=12px, 2xl/card=16px, 3xl=24px, full=9999px
 */
export const radii = {
  sm: 6,
  lg: 8,
  xl: 12,
  control: 12,
  card: 16,
  '2xl': 16,
  '3xl': 24,
  full: 9999,
  pill: 9999,
  small: 8,
  hero: 24,
} as const;

/**
 * Spacing grid per MOBILE_SPEC.md § 1.7
 * 4px scale, card padding 20px (mobile), list rows >= 56px, min touch target 48x48
 */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  cardMobile: 20,
  lg: 20,
  xl: 24,
  xxl: 32,
  section: 28,
  minTarget: 48,
  minListRow: 56,
} as const;

/**
 * Shadows per MOBILE_SPEC.md § 1.7
 */
export const shadows = {
  light: {
    card: {
      shadowColor: '#26372A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 2,
    },
    float: {
      shadowColor: '#26372A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 28,
      elevation: 8,
    },
  },
  dark: {
    card: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4,
      shadowRadius: 6,
      elevation: 3,
    },
    float: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 32,
      elevation: 10,
    },
  },
  hc: {
    card: {
      shadowOpacity: 0,
      elevation: 0,
    },
    float: {
      shadowOpacity: 0,
      elevation: 0,
    },
  },
} as const;

/**
 * Typography Scale per MOBILE_SPEC.md § 1.6
 */
export const typography = {
  sm: { fontSize: 14, lineHeight: 20 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 26 },
  xl: { fontSize: 20, lineHeight: 28 },
  '2xl': { fontSize: 24, lineHeight: 32 },
  '3xl': { fontSize: 32, lineHeight: 40 },
  '4xl': { fontSize: 44, lineHeight: 52 },
  h3: { fontSize: 18, lineHeight: 26, fontWeight: '700' as const },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '700' as const },
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700' as const },
  kpi: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
} as const;
