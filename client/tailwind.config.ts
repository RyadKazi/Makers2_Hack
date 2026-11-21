import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

/** Palette comes from CSS variables (RGB channels) so the three themes switch at runtime. */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    screens: {
      sm: '640px',
      tablet: '768px', // icon rail + drawer
      desk: '1200px', // sidebar + optional right panel
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',
      canvas: token('canvas'),
      card: token('card'),
      'surface-2': token('surface-2'),
      ink: token('ink'),
      muted: token('muted'),
      line: token('line'),
      'line-strong': token('line-strong'),
      focus: token('focus'),
      primary: { DEFAULT: token('primary'), 800: token('primary-800'), 50: token('primary-50') },
      'on-primary': token('on-primary'),
      route: { DEFAULT: token('route'), 100: token('route-100'), text: token('route-text') },
      available: { DEFAULT: token('available'), bg: token('available-bg') },
      occupied: { DEFAULT: token('occupied'), bg: token('occupied-bg') },
      club: { DEFAULT: token('club'), bg: token('club-bg') },
      warning: { DEFAULT: token('warning'), bg: token('warning-bg') },
      danger: { DEFAULT: token('occupied'), bg: token('occupied-bg') },
      /* Source presentation palette. Use primary/route for theme-aware text. */
      forest: { DEFAULT: token('forest'), hover: token('forest-hover') },
      olive: token('olive'),
      sage: token('sage'),
      soft: token('soft'),
      cream: token('cream'),
    },
    fontFamily: {
      sans: ['"Atkinson Hyperlegible"', '"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      arabic: ['"IBM Plex Sans Arabic"', '"Atkinson Hyperlegible"', 'system-ui', 'sans-serif'],
    },
    fontSize: {
      // rem only: the root size follows the user's text scale (100–200 %).
      sm: ['0.875rem', { lineHeight: '1.25rem' }],
      base: ['1rem', { lineHeight: '1.5rem' }],
      lg: ['1.125rem', { lineHeight: '1.625rem' }],
      xl: ['1.25rem', { lineHeight: '1.75rem' }],
      // Large guidance text (instruction bar, audio mode).
      '2xl': ['1.5rem', { lineHeight: '2rem' }],
      '3xl': ['2rem', { lineHeight: '2.5rem' }],
      '4xl': ['2.75rem', { lineHeight: '3.25rem' }],
      h3: ['1.125rem', { lineHeight: '1.625rem', fontWeight: '700' }],
      h2: ['var(--fs-h2)', { lineHeight: 'var(--lh-h2)', fontWeight: '700' }],
      h1: ['var(--fs-h1)', { lineHeight: 'var(--lh-h1)', fontWeight: '700' }],
      display: ['var(--fs-display)', { lineHeight: 'var(--lh-display)', fontWeight: '700' }],
      kpi: ['var(--fs-kpi)', { lineHeight: 'var(--lh-kpi)', fontWeight: '700' }],
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700', extrabold: '800', black: '900' },
    extend: {
      borderRadius: { lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', control: '0.5rem', card: '0.75rem' },
      boxShadow: {
        xs: 'var(--shadow-card)',
        sm: 'var(--shadow-card)',
        md: 'var(--shadow-card)',
        lg: 'var(--shadow-float)',
        xl: 'var(--shadow-float)',
        '2xl': 'var(--shadow-float)',
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        none: 'none',
      },
      spacing: { 18: '4.5rem', sidebar: 'var(--sidebar-w)', rail: '72px', panel: '400px' },
      minHeight: { target: '3rem' },
      minWidth: { target: '3rem' },
      transitionTimingFunction: { sheet: 'cubic-bezier(.32,.72,0,1)' },
      transitionDuration: { fast: 'var(--dur-fast)', sheet: 'var(--dur-sheet)' },
      zIndex: { bar: '30', sheet: '40', overlay: '50', toast: '60' },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('hc', '[data-theme="hc"] &');
      addVariant('reduced', '[data-motion="reduce"] &');
    }),
  ],
} satisfies Config;
