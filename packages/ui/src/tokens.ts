// What: All design tokens as typed constants — single source of truth
// Why: Framework-agnostic (no Tailwind, no React). Consumed by tailwind.config and components.
// Does NOT: Import any framework. Values derived mechanically from DESIGN.md.

export const breakpoints = {
  sm: 375,
  md: 768,
  lg: 1024,
  xl: 1440,
  '2xl': 2560,
} as const;

export const spacing = {
  '2xs': '2px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
  '3xl': '64px',
} as const;

export const radius = {
  micro: '100px',
  sm: '10px',
  default: '12px',
  lg: '20px',
  screen: '36px',
} as const;

export const colors = {
  light: {
    primary: '#D4603A',
    'primary-pressed': '#A8471E',
    'primary-soft': '#FBE8E0',
    background: '#FDFAF6',
    surface: '#FFFFFF',
    'surface-2': '#F5F0E8',
    border: '#E8E0D4',
    'text-primary': '#1A1208',
    'text-secondary': '#7A6A56',
    'text-tertiary': '#A8998A',
    success: '#5A8A5E',
    'success-bg': '#EBF4EC',
    warning: '#E8A228',
    'warning-bg': '#FDF4E3',
    error: '#C0392B',
    'error-bg': '#FAEAE8',
    info: '#3B82B4',
    'info-bg': '#EBF3FA',
  },
  dark: {
    primary: '#D4603A',
    'primary-pressed': '#A8471E',
    'primary-soft': '#3A2018',
    background: '#1A1208',
    surface: '#2A2018',
    'surface-2': '#38301F',
    border: '#3A3020',
    'text-primary': '#F5EFE6',
    'text-secondary': '#A8998A',
    'text-tertiary': '#7A6A56',
    success: '#4E7A52',
    'success-bg': '#1E2E1F',
    warning: '#C98E22',
    'warning-bg': '#2E2510',
    error: '#A33125',
    'error-bg': '#2E1A18',
    info: '#3572A0',
    'info-bg': '#1A2530',
  },
} as const;

export const fonts = {
  display: "'Fraunces', Georgia, serif",
  body: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
} as const;

export const fontScale = {
  display: { size: '56px', weight: '400', lineHeight: '1.1' },
  'display-italic': { size: '36px', weight: '300', lineHeight: '1.2' },
  'heading-lg': { size: '28px', weight: '600', lineHeight: '1.2' },
  'heading-md': { size: '22px', weight: '600', lineHeight: '1.3' },
  'body-lg': { size: '17px', weight: '400', lineHeight: '1.5' },
  body: { size: '15px', weight: '400', lineHeight: '1.5' },
  caption: { size: '13px', weight: '400', lineHeight: '1.4' },
  micro: { size: '11px', weight: '600', lineHeight: '1.3' },
} as const;

export const duration = {
  micro: '75ms',
  short: '200ms',
  medium: '300ms',
  long: '500ms',
} as const;

// Motion + feedback tokens — see DESIGN.md § Motion + feedback and the
// "Latency feedback tiers" gotcha in CLAUDE.md for the framework these
// values calibrate.
//
// FEEDBACK_THRESHOLD_MS — Tier B spinner threshold. Submit buttons disable
// instantly on click; the spinner only appears if the action is still
// pending after this many milliseconds. Calibrated so fast resolves
// (<250ms RTT) feel snappy without flashing a spinner.
export const FEEDBACK_THRESHOLD_MS = 250;

// RETRY_BUDGET_MS — Tier A2 total retry window. After this, a failed
// optimistic mutation escalates to SyncErrorBanner.
export const RETRY_BUDGET_MS = 15000;

// RETRY_BACKOFF_MS — Tier A2 retry delays. Sum (1+3+7=11s) plus ~4× attempt
// RTT lands inside RETRY_BUDGET_MS.
export const RETRY_BACKOFF_MS = [1000, 3000, 7000] as const;
