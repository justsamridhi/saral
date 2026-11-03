---
name: Saral Monochrome Fluid
colors:
  surface: '#f9f9fa'
  surface-dim: '#dadadb'
  surface-bright: '#f9f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeef'
  surface-container-high: '#e8e8e9'
  surface-container-highest: '#e2e2e3'
  on-surface: '#1a1c1d'
  on-surface-variant: '#46464a'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#77777b'
  outline-variant: '#c7c6ca'
  surface-tint: '#5f5e5f'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1c'
  on-primary-container: '#858384'
  inverse-primary: '#c8c6c7'
  secondary: '#5e5e63'
  on-secondary: '#ffffff'
  secondary-container: '#e4e1e8'
  on-secondary-container: '#646469'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1b22'
  on-tertiary-container: '#83838b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e3'
  primary-fixed-dim: '#c8c6c7'
  on-primary-fixed: '#1c1b1c'
  on-primary-fixed-variant: '#474647'
  secondary-fixed: '#e4e1e8'
  secondary-fixed-dim: '#c7c5cc'
  on-secondary-fixed: '#1b1b20'
  on-secondary-fixed-variant: '#46464b'
  tertiary-fixed: '#e3e1eb'
  tertiary-fixed-dim: '#c7c5ce'
  on-tertiary-fixed: '#1a1b22'
  on-tertiary-fixed-variant: '#46464e'
  background: '#f9f9fa'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e3'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 3.5rem
    fontWeight: '600'
    lineHeight: 4rem
    letterSpacing: -0.04em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '500'
    lineHeight: 2rem
    letterSpacing: -0.02em
  display-metric:
    fontFamily: Inter
    fontSize: 3rem
    fontWeight: '500'
    lineHeight: 3.25rem
    letterSpacing: -0.03em
  display-metric-mobile:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: '500'
    lineHeight: 2.5rem
    letterSpacing: -0.02em
  title-sm:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 1.75rem
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  data-mono:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  margin: 2rem
  margin-sm: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system embodies the ethos of "सरल" (effortless, lucid, unadorned). It merges stark high-contrast monochrome discipline with organic fluidity, bringing institutional confidence to personal and corporate wealth orchestration.

### Brand Personality & Philosophy
- **Unflinching Clarity:** Absolute black and white clarity stripped of decorative gradients, synthetic noise, or chromatic distraction.
- **Architectural Tactility:** Premium financial software treated like a precision instrument. Dense tabular data coexists alongside generous negative space.
- **Fluid Restraint:** The visual signature utilizes subtle continuous wave curves and soft capsule structures to temper the razor-sharp monetary data with natural human flow.

### Design Movement & Aesthetic Direction
A tailored synthesis of **Swiss Neo-Grotesque Brutalism** and **Tactile Minimalism**:
- **Contrast Ratios:** Pure dark-mode capable obsidian black grounded against stark white and precision-calibrated soft zinc surfaces.
- **Monochrome Dominance:** 95% of UI surfaces exist within an ink-to-paper spectrum; color is relegated strictly to semantic state triggers (confirmation, escrow lock, execution failure).
- **Physical Affordances:** Capsule-segmented toggles, pill actions, and deeply filleted container cards (`rounded-2xl`).

## Colors

The palette establishes an authoritarian monochrome hierarchy accented by whisper-level functional pigments.

### Monochrome Foundation
- **Ink (`#0B0B0C`):** Primary canvas foreground, primary buttons, impactful headlines, and structural boundaries.
- **Graphite (`#3A3A3F`):** Secondary labels, prominent icons, active borders, and pressed states.
- **Muted Grey (`#73737B`):** Tertiary meta-labels, inline currency identifiers, and inactive timestamps.
- **Light Grey (`#E4E4E7`):** Hairline structural borders, subtle dividers, and ghost pill outlines.
- **Soft Grey (`#F4F4F5`):** Recessed canvas fills, secondary capsule backdrops, and active row highlights.
- **Pure White (`#FFFFFF`):** Base canvas in light mode, foreground text on primary buttons, card surfaces.

### Semantic Accents (Micro-Dosed)
Status indicators must never flood container surfaces. Color is restricted to status pips (6px), micro badges, and tabular balance shifts:
- **Settled / Positive:** `#16A34A`
- **In Escrow / Pending:** `#D97706`
- **Rejected / Terminated:** `#DC2626`

## Typography

Typographic execution relies on disciplined scale, tighter tracking at display scales, and OpenType features.

### OpenType & Metric Control
- **Tabular Numerals:** All financial metrics, balance counters, percentages, and timestamps must explicitly enable `font-feature-settings: "tnum" 1, "cv05" 1, "zero" 1`.
- **Display Weights:** Large financial totals avoid extra-bold treatments, employing 500 (Medium) and 600 (SemiBold) to retain Swiss editorial elegance.
- **Uppercase Meta Labels:** Used for asset categories, security tickers, and transaction states. Always paired with wide letter-spacing (`0.08em`) and strict sentence-casing everywhere else.

## Layout & Spacing

The architecture operates on an 8-point base module, anchored by fluid multi-column responsive divisions and deliberate horizontal margins.

### Grid & Breakpoints
- **Mobile (320px – 767px):** Single-column layout. Margin: `1rem` (`margin-sm`), Gutter: `1rem` (`gutter-sm`). Full-width edge-docked bottom capsule bar for mission-critical actions.
- **Tablet (768px – 1023px):** 8-column layout. Margin: `1.5rem`, Gutter: `1.5rem`.
- **Desktop (1024px+):** 12-column layout. Max container width: `1280px` centered. Margin: `2rem` (`margin`), Gutter: `1.5rem` (`gutter`). Secondary telemetry panels pin to a 4-column right rail.

### Wave Brand Geometry
Section transitions utilize low-frequency, high-precision SVG fluid wave masks (maximum vertical amplitude of 24px across the container). These waves must never obstruct typographic baselines or interactive controls; they serve strictly as surface boundary transitions between Ink, Soft Grey, and Pure White containers.

## Elevation & Depth

This design system avoids traditional dropped blur shadows, simulating elevation through contrast stratification, hairline borders, and tactile displacement.

### Surface Tiers
1. **Tier 0 (Backdrop / Bedrock):** `#F4F4F5` (Soft Grey).
2. **Tier 1 (Base Cards & Modules):** `#FFFFFF` (White) surfaced with a crisp `1px solid #E4E4E7` perimeter.
3. **Tier 2 (Floating Action Capsules):** `#0B0B0C` (Ink) with high optical separation; or `#FFFFFF` overlaying content with a 1px border (`#E4E4E7`) paired with a razor-thin directional offset: `0px 4px 12px rgba(11, 11, 12, 0.04)`.
4. **Tier 3 (Modals & Sheets):** Strict modal overlays with an Ink backdrop set to 60% opacity (`#0B0B0C99`) paired with background blur (`backdrop-filter: blur(8px)`).

### Border Philosophy
Hairlines replace heavy shading. Dividers, card boundaries, and segmented controls default to `1px` lines utilizing `#E4E4E7`. In dark or nested instances, boundaries step to `#3A3A3F`.

## Shapes

Form geometry emphasizes intentional contrast: structural card bodies feature generous curvature, while interactive components adopt aerodynamic pill capsules.

### Geometry Hierarchy
- **Cards & Data Modules:** Explicitly set to `rounded-2xl` (`1.25rem` / `20px` to `1.5rem` / `24px` radius). Creates a smooth, continuous silhouette that harmonizes with wave dividers.
- **Actions, Inputs & Toggles:** Set to fully rounded pill geometry (`rounded-full` / `9999px`).
- **Inner Embedded Items (List items, sub-blocks):** Scaled down to `rounded-xl` (`0.75rem` / `12px`) to preserve geometric concentricity with the parent card.

## Components

### Buttons & CTAs
- **Primary Pill:** Background `#0B0B0C`, text `#FFFFFF`, fully rounded (`9999px`). Padding: `0.75rem 1.75rem`. Hover state transitions background to `#3A3A3F`. Active scale down to `0.98`.
- **Secondary Pill:** Background `#F4F4F5`, text `#0B0B0C`, border `1px solid transparent`. Hover shifts border to `#E4E4E7` and background to pure white.
- **Ghost Action:** Border `1px solid #E4E4E7`, background transparent, text `#0B0B0C`.

### Cards & Modules
- Main containers employ `rounded-2xl`, background `#FFFFFF`, and `1px solid #E4E4E7`.
- **Hero Fluid Cards:** Ink container (`#0B0B0C`) with inverted white typography, displaying portfolio valuation. Incorporates a dynamic, subtle wave backdrop stroke (`#3A3A3F` at 30% opacity).

### Tactile Capsule Navigation
- Navigational bars float above the viewport baseline (`bottom: 1.5rem`).
- Capsule shell: `rounded-full`, backdrop blur `12px`, background `rgba(255, 255, 255, 0.9)`, border `1px solid #E4E4E7`.
- Active segment: Inverted `#0B0B0C` pill with `#FFFFFF` label and icon, animated horizontally with smooth spring motion.

### Input Fields
- Enclosed in `rounded-full` capsules for single-line search/transfer queries, or `rounded-xl` for dense numerical parameters.
- Default state: Background `#F4F4F5`, border `1px solid transparent`, text `#0B0B0C`, placeholder `#73737B`.
- Focused state: Background `#FFFFFF`, border `1px solid #0B0B0C`, zero ambient glow.

### Lists & Ledger Rows
- Tabular row layout with `0.875rem` vertical cell padding.
- Hairline baseline separator using `#E4E4E7`. Hover initiates background tint to `#F4F4F5`.
- Strict column distribution: Counterparty identity (left), Status indicator pip (center), and Right-aligned amount with tabular numerals (`Inter` tnum).

### Checkboxes & Segmented Controls
- **Segmented Control:** Capsule track (`#F4F4F5`, padding `4px`, `rounded-full`) hosting sliding pill thumb (`#FFFFFF` with subtle hairline edge).
- **Checkboxes:** Square with gentle filleted corners (`4px`), `1.5px` border `#3A3A3F`. Checked state fills `#0B0B0C` with an inverted white checkmark.