/**
 * App-icon variants offered in Settings.
 *
 * Ids and order are kept in sync by hand with `electron/ipc/app-icon.ts`
 * (which resolves the PNGs) and with the files under `build/icons/`.
 *
 * `swatch` is not a thumbnail of the PNG: the variants share one geometry, so
 * the preview is drawn inline from these three colours. That keeps Settings
 * free of image loading and keeps the swatch crisp at any size.
 */
export type AppIconId =
  | 'terminal-green'
  | 'signal-amber'
  | 'indigo-dusk'
  | 'nord'
  | 'mono-paper'
  | 'classic';

export const DEFAULT_APP_ICON: AppIconId = 'terminal-green';

export interface AppIconVariant {
  id: AppIconId;
  /** English label; run through `tr()` at the call site. */
  label: string;
  bg: string;
  track: string;
  live: string;
  /** The original pre-redesign mark, drawn from its own path rather than the bars. */
  legacy?: boolean;
}

export const APP_ICON_VARIANTS: readonly AppIconVariant[] = [
  {
    id: 'terminal-green',
    label: 'Terminal Green',
    bg: '#0E1F17',
    track: '#1E3A2C',
    live: '#7DFF9B',
  },
  { id: 'signal-amber', label: 'Signal Amber', bg: '#12100C', track: '#3A2E1A', live: '#FFB020' },
  { id: 'indigo-dusk', label: 'Indigo Dusk', bg: '#0B0F1E', track: '#1E2540', live: '#8B9DFF' },
  { id: 'nord', label: 'Nord', bg: '#2E3440', track: '#4C566A', live: '#88C0D0' },
  { id: 'mono-paper', label: 'Mono Paper', bg: '#F2F0EB', track: '#D9D5CC', live: '#17181A' },
  {
    id: 'classic',
    label: 'Classic',
    bg: '#000000',
    track: '#000000',
    live: '#2ec8ff',
    legacy: true,
  },
];

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === 'string' && APP_ICON_VARIANTS.some((variant) => variant.id === value);
}
