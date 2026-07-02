# Design

## North Star

**"Heraldic Ledger"** — a self-hosted contacts app that treats each entry like an entry in a well-kept personal record book: wax-seal avatars, a brass-gold accent against deep forest tones, serif display type paired with plain-spoken mono for data. Confident and a little ceremonial, never precious. See `PRODUCT.md` for the strategic brief this serves.

## Color Strategy

**Restrained.** Tinted dark-forest neutrals carry the surface; brass-gold (`--accent`) is the single accent, reserved for selection state, primary actions, and the seal-ring detail. Sage is a rare secondary, used sparingly (status/tag accents only — confirm before extending its role).

## Palette

All values are the live CSS custom properties in `app/globals.css`. Treat this table, not a re-derivation, as the source of truth.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#1b1f1d` | Page background — near-black forest green |
| `--surface` | `#20261f` | Panel/sidebar background |
| `--surface-raised` | `#262d25` | Raised surface — hovered/selected rows, modal panels |
| `--text` | `#e8e4d9` | Primary text — warm off-white, not pure white |
| `--text-dim` (`muted`) | `#c2cbbf` | Secondary text, placeholders, meta |
| `--accent` | `#c9a44c` | Brass-gold — primary accent, selection, primary actions |
| `--accent-dim` | `#8a7239` | Muted gold — borders, section-label text, hover states |
| `--sage` | `#6b8577` | Secondary accent — use sparingly |
| `--divider` | `#333b32` | Default hairline border |
| `--divider-soft` | `#2a3128` | Quieter hairline (nested dividers, form-section rules) |

Interactive accent tints are composed inline as low-alpha brass-gold, not new tokens: `rgba(201,164,76,0.08)` resting / `rgba(201,164,76,0.15)` hover for primary action fills; `rgba(201,164,76,0.25–0.3)` for the seal-ring stroke.

**Rule:** never introduce a second saturated accent hue. Status color (e.g. destructive actions) borrows `red-500/400` at low opacity on hover only — it does not get a resting token.

## Typography

Three families, each with a fixed job — do not blend their roles.

- **`Fraunces`** (serif) — display only: contact names, section headers where weight matters. This is the "ledger" voice.
- **`"IBM Plex Sans"`** (`plex`) — body copy, form values, UI prose. The plain-spoken counterweight to Fraunces.
- **`"IBM Plex Mono"`** (`mono`) — structural/meta text only: uppercase tracked section labels (`text-[10px] tracking-widest uppercase`), button labels (`text-[11px] tracking-wider`), index-rail letters, tag pills. Mono signals "this is metadata," not prose.

Scale runs small and dense by design (`10px`–`16px` for nearly all UI text) — this is a data-dense personal tool, not an editorial page. Don't inflate type scale in new components; match the existing `text-[10px]`–`text-[16px]` range and mono-for-meta / plex-for-content / Fraunces-for-names split.

## Shape & Elevation

- **Radii**: `rounded-full` for all buttons and pills (the signature shape — action buttons, tags, the mono-label pills). `rounded-md` for inputs and standard containers. `rounded-lg`/`rounded-xl` for modal panels and larger surfaces. `rounded-[3px]` appears once for a specific tight-corner case — don't generalize it.
- **Borders**: 1px `border-divider` is the default container/input border; `border-divider-soft` for quieter internal rules (e.g. under `FormSection` labels). Focus state swaps to `border-accent-dim`, never a color outside the palette.
- **Selection state**: list rows use an **inset** box-shadow (`shadow-[inset ...]`) with the accent color to mark the selected row, not a real `border-left` — this avoids layout shift and reads as a subtle frame rather than a decorative stripe. Reuse this technique for any new selectable-row pattern; do not add a literal colored `border-left`/`border-right`.
- **Seal motif**: avatars (`Seal.tsx`) use a diagonal gradient (`linear-gradient(155deg, #2c342a, #1e241c)`) with a `::before` ring at low-alpha brass-gold and, at large size, an outer `::after` ring in `divider-soft`. This is the one place literal decorative rings belong — don't repeat the motif outside avatars.
- **Shadows**: modals use `shadow-2xl`/`shadow-lg` for panel elevation; everything else stays flat. Don't add shadow to routine cards/rows — elevation is reserved for things that float above the page (modals, popovers).

## Motion

- **Easing**: entrances use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo family) — no bounce, no elastic, matching the skill's global motion rules. Simple fades use plain `ease-out`/`ease-in`.
- **Durations**: 120–180ms across the board (backdrop fade 160ms in / 120ms out, panel 180ms in / 120ms out, popover 140ms, detail-pane enter 180ms). Keep new transitions inside this range — the app should feel immediate, not showy.
- **Entrance pattern**: opacity + small transform (`scale(0.94–0.97)` and/or `translateY(2–4px)`), never a large-distance slide.
- **Press feedback**: the shared `.press` utility (`active:scale-96`, 100ms ease-out) is applied to every clickable action button — reuse the class rather than reimplementing.
- **Reduced motion**: already handled globally — all keyframe animation lives inside `@media (prefers-reduced-motion: no-preference)`, and `.press` has an explicit `reduce` override. Any new animation must follow the same wrapping pattern, not a per-component opt-out.

## Components

- **Buttons** (`ActionButton` pattern): pill-shaped, `font-mono text-[11px] tracking-wider`, 1px border, three variants — `primary` (accent border + low-alpha accent fill, for the one confirming action per view), `default` (divider border, accent on hover), `danger` (divider border, red only on hover, never a resting red fill). Never add a fourth variant without a reason; compose these three.
- **Inputs** (`inputCls`): transparent background, `border-divider`, `rounded-md`, `text-[13px]`, focus swaps border to `accent-dim` — no focus ring/glow, the border color shift *is* the focus state.
- **Form sections** (`FormSection`): mono, uppercase, `tracking-widest`, `text-[10px]`, `accent-dim` colored label with a `border-divider-soft` bottom rule. This is the standard way to group a form — reuse it instead of ad-hoc `<h3>`s.
- **Modals**: backdrop + panel, both driven by the shared `modal-backdrop`/`modal-panel` animation classes (with `.closing` variants for exit). Footer convention is cancel (default pill) + save (primary pill), right-aligned.
- **Language**: UI copy is German (`Bearbeiten`, `Löschen`, etc.) — match existing copy's register (plain, direct) for any new strings.

## Don't

- Don't add a second saturated accent color — brass-gold is the only one.
- Don't use a literal `border-left`/`border-right` for selection or emphasis — use the inset-shadow technique already established, or a background tint.
- Don't inflate the type scale — this is a dense utility tool; new text should fit the existing `10–16px` range.
- Don't add drop shadows to routine rows/cards — reserve elevation for modals and popovers.
- Don't introduce a fourth font family or use Fraunces for body copy / Plex Sans for names — the three-family role split is load-bearing.
- Don't add bounce/elastic easing or entrance transforms larger than a few px/a small scale — motion here is quiet, not showy.
