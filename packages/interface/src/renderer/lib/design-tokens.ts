/**
 * Design tokens — punto di verità TS per la scala visiva.
 *
 * Le classi CSS semantiche (text-display/text-view-title/text-body/text-meta/…)
 * definite in styles.css sono il modo idiomatico per applicarle nei componenti.
 * Questo modulo espone le costanti per chi serve in JS (validazioni,
 * documentazione, eventuali widget custom).
 */

export const FONT_SIZE_PX = {
  micro: 10,
  meta: 11,
  body: 12,
  bodyLg: 13,
  sectionTitle: 14,
  viewTitle: 16,
  kpi: 20,
  display: 28,
} as const;

export const SPACING_PX = {
  tight: 8,
  comfortable: 12,
  roomy: 16,
  section: 24,
} as const;

/**
 * Superfici a 4 livelli con stacco ≥5% lightness per garantire bordi
 * percepibili anche con border-border/70 nidificati.
 */
export const SURFACE_LEVELS = [
  "background",
  "surface-subtle",
  "surface-raised",
  "popover",
] as const;
export type SurfaceLevel = (typeof SURFACE_LEVELS)[number];

/**
 * Tone tokens. Usati da StatusPill, Badge, ActionBanner per esprimere
 * stato semantico in modo coerente.
 */
export const TONES = ["success", "warning", "danger", "info", "neutral"] as const;
export type Tone = (typeof TONES)[number];

/**
 * Breakpoint sincronizzati con tailwind.config.ts.
 */
export const BREAKPOINTS_PX = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
  "3xl": 1800,
} as const;
export type Breakpoint = keyof typeof BREAKPOINTS_PX;
