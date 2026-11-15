# Backstage Forever style guide

The one look every page, window and in-game frame follows. Written for the art review before 1.0 (roadmap G12, 0.54); `tests/style-guide.test.cjs` checks the measurable rules.

## Feel

A premium fantasy companion: an adventurer's journal by lamplight. Dark midnight-teal surroundings, antique gold trim, parchment cards for reading, painted art for every page banner. Calm, never noisy; the art frames the information, it never competes with it.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d161e` | Window background (midnight teal) |
| `--panel` | `#14212b` | Dark panels |
| `--text` | `#edf0e8` | Text on dark |
| `--muted` | `#a6b8bd` | Secondary text on dark |
| `--gold` | `#dab77a` | Trim, links on dark |
| Parchment | `#efe0bb` → `#dcc797` | Reading cards (gradient top to bottom) |
| Ink | `#2b1b0a`, `#3d220c` | Text and headings on parchment |
| Ink, soft | `#5a3e1c`, `#6b4e26` | Notes and small text on parchment |
| Label gold | `#664808` | Small uppercase labels on parchment |
| Bright gold | `#f4cf72` | Headings and buttons on dark, focus ring |
| Horde / Alliance | `#e29179` / `#84b9df` accents, deep `#5a1410` / `#10305a` | Faction themes (G11), always equal treatment |

Status chips with white text use the AA-safe shades: blue `#3776be`, green `#468134`, orange `#b55724`, amber `#a56320`, red `#c33d29`, grey `#79736a`.

**Contrast:** every text colour meets WCAG AA, 4.5:1, against the background it sits on (for gradients, against its darkest and lightest stop that the text covers). Big headings over painted art carry a text shadow.

## Type

- Headings, labels and buttons: **Cinzel** (Georgia as fallback), bold.
- Reading text: **Segoe UI**, 14px base; parchment prose may use Georgia.
- **Dark-room minimum: 11px** for any text. The only exception is decorative lettering inside a painted seal.
- Small uppercase labels: 10–12px Cinzel would be too small; use 11px with letter-spacing `.1em`–`.14em`.

## Spacing and shape

- Page sections stack with a **14px** gap; cards pad **14px 16px**; grids use **10–12px** gaps.
- Cards: 6px radius, 1px `#a5823e` border, soft inset shadow plus a 4px drop shadow.
- Buttons: the carved-wood style from `enchanted.css` (primary in gold); small in-card buttons use the dark leather style (`#3d220c` with gold text).
- Every page opens with a painted banner (`PageHero`): eyebrow, title, one-line subtitle, and the class or faction crest.

## Motion

- Slow and ambient: banner drift (38s), embers, one-off celebrations. Nothing flashes or loops fast.
- Everything stops when Windows asks for less motion (`prefers-reduced-motion`).

## Buttons

- Framed buttons draw brass end caps about 12px wide on each side: keep at least 12px of side padding so they never cover a letter.
- A pill or text link restyled with `all: unset` must also drop the end caps (listed in `enchanted.css`; a test checks every such rule), or they land on the nearest card or the window edge.
- A card that is a `<button>` (zone tiles, list rows) needs a selector stronger than `button:not(.illustrated-card)` for its background and text colour, or it turns into a dark button with dark text.
- Check a page with `node scripts/dev-preview-pages.cjs OUT 1440x960 en` (and `de`): it saves every page and lists any of the above it finds.

## Art

- Original only, painted locally with ComfyUI (Qwen-Image), or the earlier original sets listed in `src/renderer/art/NOTICE.md` and `docs/ARTWORK*.md`. Nothing from Blizzard games, no logos, no lettering in paintings.
- Show Frank samples before a new set of art goes in.
- In game: textures are power-of-two TGAs under 1 MB, cut so corners never stretch (nine-slice and three-slice frames).

## Accessibility

- Every control has a name, every image a description; the focus ring always shows; Windows high-contrast mode keeps controls outlined.
- Never rely on colour alone: quality, difficulty and status are also written in words or shown by shape.
