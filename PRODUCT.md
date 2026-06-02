# Design Context

### Users
Crypto / prediction-market traders on X. They encounter Cassie surfaces mid-scroll
(mobile + desktop) and screenshot them. The flagship surface is the **trade share /
OG card** (`apps/web/app/components/trade-card.tsx`, `band` variant) — the image
posted when a Cassie-expressed call resolves.

### Brand Personality
Moneyed, exacting, triumphant. The card is an **auction-catalogue "lot card" for a
trade** — a verified record of a call, presented with restraint and prestige, not a
hype sticker. Voice: editorial, confident, quiet.

### Aesthetic Direction
- **Luxe prestige, evolved** — black & gold editorial. Dark theme (traders, night,
  X timeline).
- **Job = flex the win.** The PnL figure is the object; everything else is hushed.
- **Palette:** flat warm near-black surface (`oklch(~0.12 0.008 88)`, NO gradient
  bloom — flattened on purpose), brass/gilt (`--tc-gilt`) as the single luxe accent,
  and result green/red (`--tc-up` / `--tc-down`) reserved ONLY for the figure, the
  side, and the tick. Tint neutrals toward the gold hue (~86).
- **Type:** Bodoni Moda (`--font-numeral`, didone) for the hero figure; EB Garamond
  italic (`--font-display`) for the quoted call + wordmark; Manrope (`--font-sans`)
  for labels; mono (`--tc-mono`) for price figures only.
- **Layout:** two-column lot card — left = quoted call + one-line "why" + giant
  figure anchored bottom-left; right = a spec sheet (byline, venue, side, entry,
  mark, market question); a 1px gilt divider between. Engraved inner frame + faint
  paper grain for the certificate feel.

### Anti-references
- Hyperliquid's teal-on-dark cyber look (we admire its restraint, not its palette).
- AI slop: cyan/purple gradients, decorative background glows, glassmorphism,
  gradient text, stat-card grids, the hero-metric KPI template, sparkline decoration.
- Gimmick ornaments (the laurel wreath and the wax-seal "coin" were both tried and
  rejected as cheap/detached — ornament must be typographic/structural, not stuck-on).

### Design Principles
1. **The figure is the hero.** Oversized didone numeral; nothing competes with it.
2. **Gold is rare and structural** — hairlines, rules, the divider, labels. Result
   color is rarer still (figure + side only). 60/30/10 by weight.
3. **No decorative gradients or glows.** Flat surface; richness comes from type,
   rules, and grain.
4. **Editorial grid, not corners.** Balanced two-column composition; no floating
   ornaments dropped into empty space.
5. **Dignified in loss as in win** — same lot-card treatment, accent flips to red.
