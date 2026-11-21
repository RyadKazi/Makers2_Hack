# accesU — Design reference

Six reference images were supplied **for look & feel only**. Nothing is copied from them: no logos, brand names, photos, text, colours, flags or illustrations. This document turns what we take from them into implementable rules.

**Priority when things conflict:** 1) accessibility (WCAG 2.2 AA, 48 px targets, body ≥ 16 px, 3 px focus rings, colour never the only signal) → 2) PROJECT_SPEC tokens (colours, fonts) → 3) the images.

---

## 1. Per-image extraction

### Image 1 — Overall dashboard layout (take the layout; ignore colours and content)

| Observed | Implementation |
|---|---|
| Fixed left sidebar ≈ 240 px: brand at the top, then grouped navigation with small section headings | `w-60` (240 px) sidebar, `ps-4 pe-3 py-4`. Section headings: `text-sm font-bold text-muted px-3 pt-5 pb-2`, sentence case |
| Active item = filled pill | `rounded-xl bg-primary text-on-primary`, item height `min-h-12` (48 px), `gap-3`, 24 px icon |
| Sub-items with a small bullet | Not used: our navigation is flat (one level). Bullets would add 48 px rows with no benefit |
| Top bar ≈ 56–64 px: collapse toggle, pill search field, icon cluster on the far side | `h-16` top bar, `border-b`, search button `h-12 rounded-full bg-surface-2 px-4 w-72` showing a `Ctrl K` hint; icon buttons 48 × 48 |
| Page title row, breadcrumb on the far side | `h1` + optional breadcrumb `text-sm text-muted`, `mb-6` |
| Light grey canvas, white cards, 16–20 px gaps | `bg-canvas` page, `bg-card` cards, `gap-4` (mobile) / `gap-6` (desktop) |
| High information density (11–13 px text) | **Not taken**: body stays 16 px and captions 14 px (§4). We get density from layout, not from small type |

### Image 2 — Map style (take the clean plan style, pins, labels, legend placement; ignore colours)

| Observed | Implementation (2D floor plan, Leaflet CRS.Simple, step 6) |
|---|---|
| Desaturated base, white circulation, buildings in one cool neutral, POIs in a single accent | Rooms `fill: --map-room` with 1 px `--map-room-stroke`, corridors `--map-corridor` (lighter than rooms), walls 2 px `--map-wall`. Only status and route use saturated colour |
| Small rectangular label tags on an accent fill, attached to features | Label tag: `rounded-md px-1.5 py-0.5 text-sm font-bold`, card background + 1 px border, sentence case (not uppercase) |
| Teardrop pins, icon inside | Pin: 36 × 44 px SVG teardrop, 20 px white icon, 2 px white outline + shadow; selected pin scales to 1.15 (no animation with reduced motion) |
| Floating rounded info panel over the map, inset ≈ 16 px, photo header, title, rating, category, row of round actions with captions, sections with headings | Desktop: **right side panel** (400 px, §3). The action row is taken: 48 px round buttons with a 14 px caption under each, `gap-4`. No photo header (we have no photos; a decorative image adds nothing for screen readers) |
| Zoom +/− and compass in the bottom corner | `end-4 bottom-4` stack of 48 px icon buttons, `rounded-xl bg-card shadow-float` |
| Legend placement | Legend card `start-4 bottom-4`, collapsible, each entry = swatch with **pattern** + icon + label |
| Isometric 3D city | **Not taken**: a flat plan is easier to read, maps 1:1 to CRS.Simple, and screen readers get a list view instead |

### Image 3 — Cards and badges (take radius, shadows, badge shape, text hierarchy)

| Observed | Implementation |
|---|---|
| Card radius ≈ 16 px, 1 px hairline border, very soft shadow, ≈ 24 px padding | `rounded-2xl border border-line bg-card shadow-card p-5 desk:p-6` |
| Tinted square icon tile (≈ 56 px, radius 12) with a coloured outline icon | `IconTile`: `size-12 rounded-xl bg-primary-50 text-primary` + 24 px icon (48 px, a multiple of 8) |
| Title medium weight, then big bold number | Label `text-base font-bold text-ink`, value `text-kpi` (32/40, bold, `tabular-nums`) |
| Pill delta badge: tinted background, arrow icon, bold %, then a muted caption | `Badge`: `rounded-full px-3 h-8 text-sm font-bold` + 16 px icon. The arrow **and** the sign (+/−) carry the meaning, not the colour |
| Status badge pill next to a title | `StatusBadge`: pill + **leading pattern swatch** + icon + label (§5) |
| Footer: secondary button "View details →" with a light fill | `Button variant="secondary"`: `bg-surface-2 text-ink rounded-xl h-12`; the arrow flips in RTL (`rtl:-scale-x-100`) |
| Stat row with dividers: small muted label above a large value | `grid grid-cols-3 divide-x divide-line` (logical: `divide-x` + `rtl:divide-x-reverse`), label `text-sm text-muted`, value `text-xl font-bold` |

### Image 4 — Mobile screens (take the bottom tab bar and the bottom sheet)

| Observed | Implementation |
|---|---|
| 5-item bottom tab bar, icon above label, active item in primary | `h-16 + safe-area`, `grid grid-cols-5`, each tab `min-h-16 flex-col gap-1 text-sm`, active: `text-primary` **plus** a 4 px pill indicator above the icon and `aria-current="page"` |
| Floor selector chip at the top | Native `<select>` styled as a chip, `h-12 rounded-full` |
| Floating map buttons (zoom, locate) ≈ 44 px | **48 px**, `rounded-xl bg-card shadow-float` |
| Bottom sheet: big top radius, title, tinted feature chip, meta line, full-width primary button with icon | `rounded-t-3xl bg-card shadow-float`, 36 × 4 px drag handle (the handle is also a 48 px button), content `p-5`, primary button `h-14 w-full rounded-2xl text-lg` |
| Current-instruction card (tinted, big turn arrow, bold instruction, distance) | `rounded-2xl bg-primary-50 p-4`, 40 px arrow icon, `text-xl font-bold`, distance `text-base text-muted` |
| Next steps as a divided list with leading icons | `divide-y divide-line`, rows `min-h-14 gap-4`, 24 px icons |
| Summary bar (distance, ETA, step-free) | Same 3-column stat row as Image 3 |
| Destructive "Stop" in the top corner | `Button variant="danger-outline" size="md"`: always text + icon, never colour only |

### Image 5 — Chat / captions (take the message / caption style and the input bar)

| Observed | Implementation (Talk page, step 8) |
|---|---|
| Incoming bubbles on the start side, light fill; outgoing on the end side in the primary colour | Incoming `bg-surface-2 text-ink rounded-2xl rounded-ss-md`, outgoing `bg-primary text-on-primary rounded-2xl rounded-se-md`, `max-w-[75ch]`, `px-4 py-3` |
| Speaker name + avatar above incoming messages | `text-sm font-bold` name, 32 px avatar with initials (no photos) |
| Translation as a second, smaller, muted line inside the bubble | `mt-1 text-sm opacity-90 border-t border-current/20 pt-1` with `lang` set on the translated span |
| Language selector pill at the top; popover listing languages with a check on the selected one | Pill `h-12 rounded-full`; listbox popover `rounded-2xl shadow-float`, items `min-h-12`, check icon + `aria-selected` |
| Round control buttons (≈ 64 px) with a caption under each | `size-16 rounded-full` + caption `text-sm` (also the visible label) |
| Input bar | `sticky bottom-0`, `rounded-2xl bg-card border shadow-float p-2 flex gap-2`, textarea (auto-grow, 48 px minimum), mic and send icon buttons 48 px |
| Dark translucent glass over a photo | **Not taken**: text on blurred photos fails contrast unpredictably. Talk uses the solid `--canvas` / `--card` tokens of the active theme |
| Flags to pick languages | **Not taken**: flags are not languages. Each language is written in its own script: العربية · Français · English |

### Image 6 — Admin dashboard (take KPI cards, chart style, filter bar)

| Observed | Implementation (admin, step 9) |
|---|---|
| KPI row of 4 equal cards: label, small context icons, big number, delta line with a status icon | `grid grid-cols-1 sm:grid-cols-2 desk:grid-cols-4 gap-4`, Card + label `text-base font-bold` + `text-kpi` + delta `Badge` |
| Date filter button in the page header; select pills inside card headers | `h-12 rounded-xl border` buttons; card header `flex items-center justify-between gap-3` |
| Sidebar search with a "/" shortcut hint | Search hint shows `Ctrl K` (spec). `/` also focuses search when focus is not in a text field |
| Smooth lines, 2 series, dashed area fill, tooltip card, horizontal gridlines only | Recharts `type="monotone"`, `strokeWidth={3}`, series = `--primary` and `--route`, **second series dashed + different markers**, horizontal grid `--line`, tooltip = Card styles, axis text 14 px |
| Bars with fully rounded tops, future values in a lighter tint | `radius={[8, 8, 0, 0]}`; projected bars use a **hatched pattern**, not only a lighter tint |
| Horizontal progress bars with % at the end | `h-3 rounded-full bg-surface-2` track; the value is always printed as text |

---

## 2. Consolidated visual language

### Colour (source forest / cream palette wins)
CSS variables (RGB channels, so Tailwind alpha works) defined per theme in `src/styles/tokens.css`. `Makers-main` is the visual authority for brand palette, borders, radii and component anatomy; the target WCAG 2.2 AA floor still wins wherever source density or contrast falls short.

| Role | Light | Dark | High contrast |
|---|---|---|---|
| canvas | `#F8FAF7` | `#1E2E21` | `#000000` |
| card | `#FFFFFF` | `#273C2A` | `#000000` |
| surface-2 (fills) | `#F3F8E7` | `#324C35` | `#000000` |
| ink (text) | `#26372A` | `#F3F8E7` | `#FFFFFF` |
| muted (secondary text) | `#647064` | `#CADCBC` | `#FFFFFF` |
| line (borders) | `#E4E9DF` | `#476C4C` | `#FFFFFF` |
| primary / on-primary | `#476C4C` / white | `#A4C6A4` / `#1E2E21` | `#FFD60A` / black |
| primary-800 | `#324C35` | `#7D9B5F` | `#FFD60A` |
| primary-50 (tint) | `#F3F8E7` | `#324C35` | `#000000` |
| route / route-100 | `#476C4C` / `#F3F8E7` | `#A4C6A4` / `#324C35` | `#FFD60A` / black |
| route-text | `#324C35` | `#CADCBC` | `#FFD60A` |
| focus ring | `#476C4C` | `#A4C6A4` | `#FFD60A` |
| available fg / bg | `#15803D` / `#DCFCE7` | `#4ADE80` / `#0F2E1C` | white / black |
| occupied (teacher/admin) fg / bg | `#B91C1C` / `#FEE2E2` | `#FCA5A5` / `#3A1214` | white / black |
| club fg / bg | `#C2410C` / `#FFEDD5` | `#FDBA74` / `#3A1D0C` | white / black |
| warning fg / bg | `#B45309` / `#FEF3C7` | `#FCD34D` / `#3A2A0A` | white / black |

The pairs used for text are checked by `src/styles/contrast.test.ts`: ≥ 4.5:1 for text, ≥ 3:1 for borders, icons and focus rings.

### Typography
- Families: **Atkinson Hyperlegible** (Latin) and **IBM Plex Sans Arabic** (Arabic), self-hosted with @fontsource. `:lang(ar)` puts Plex first.
- Only 400 and 700 are used, because Atkinson ships only those two weights.
- All sizes are in **rem**. The root font size = 100 % × the user's text scale (1–2), so 200 % text scaling grows everything proportionally. Layouts wrap instead of clipping (no fixed heights on text containers).

| Token | Desktop (≥ 1200 px) | Mobile | Use |
|---|---|---|---|
| `text-display` | 2.25 rem / 2.75 | 1.875 / 2.375 | Landing hero |
| `text-h1` | 1.75 / 2.25 | 1.5 / 2 | Page title |
| `text-h2` | 1.375 / 1.875 | 1.25 / 1.75 | Section title |
| `text-h3` | 1.125 / 1.625 | 1.125 / 1.625 | Card title |
| `text-kpi` | 2 / 2.5, `tabular-nums` | 1.75 / 2.25 | Numbers |
| `text-base` | 1 / 1.5 | 1 / 1.5 | **Body: never smaller** |
| `text-sm` | 0.875 / 1.25 | same | Captions, metadata, badges. The minimum size anywhere |

### Spacing and density
- 4 px base grid. Card padding 20 px (mobile) / 24 px (desktop). Page padding 16 / 24 px. Gaps 12–16 (mobile) / 16–24 (desktop).
- Every interactive element is **≥ 48 × 48 px**, including chips, tabs, toggles (the hit row), tab bar items and map controls.
- Comfortable density: list rows ≥ 56 px, at most two text lines per row.

### Radius
`rounded-xl` = 12 px (buttons, inputs, icon tiles, menus) · `rounded-2xl` = 16 px (cards, dialogs, toasts) · `rounded-3xl` = 24 px (bottom sheets, floating panels) · `rounded-full` (badges, chips, avatars, search pill).

### Elevation
- `shadow-card`: `0 1px 2px rgb(15 23 42 / .04), 0 4px 16px rgb(15 23 42 / .06)`. Always combined with a 1 px border, since shadows alone are invisible to many low-vision users.
- `shadow-float` (sheets, panels, popovers, map controls): `0 8px 32px rgb(15 23 42 / .14)`.
- Dark mode: shadows at 40 % black, and cards are lighter than the canvas.
- High contrast: **no shadows**, 2 px white borders on cards and controls.

### Icons
Lucide (outline, 2 px stroke, rounded joins, which matches the images): 20 px inline, 24 px in navigation, buttons and tiles. Decorative icons are `aria-hidden`; icon-only buttons need an `aria-label`. Direction-dependent icons (arrows, chevrons, "back") flip in RTL.

### Motion
- 150 ms `ease-out` for hover and press.
- 250 ms `cubic-bezier(.32,.72,0,1)` for sheets, panels and dialogs.
- No parallax, no auto-playing animation.
- `prefers-reduced-motion` **or** the in-app "Reduce motion" setting sets every duration to 0.01 ms and disables skeleton shimmer.

### Focus
`outline: 3px solid var(--focus); outline-offset: 2px` on `:focus-visible`, for every interactive element. It is never removed. In high contrast, yellow on black.

---

## 3. Layout anatomy (from Image 1 + spec)

| Viewport | Shell |
|---|---|
| **≥ 1200 px** | Sidebar 240 px (collapsible to a 72 px rail, remembered) · top bar 64 px (search `Ctrl K`, floor selector, language, theme, profile) · main · optional **right panel 400 px** on the logical *end* side (it becomes the left side in Arabic) |
| **768–1199 px** | 72 px icon rail (icon + 14 px label under it) · "Menu" opens a drawer with the full navigation · top bar · the right panel becomes an overlay drawer |
| **< 768 px** | Compact top bar (title, search, profile) · **bottom tab bar**: Map, Rooms, Navigate, Talk, More · panels become **bottom sheets** with 3 snap points (peek 25 %, half 55 %, full 92 %) |

Landmarks: `header` (banner), `nav` (with an `aria-label` per navigation), `main#main`, `aside` (right panel, labelled), `footer` on public pages. A skip link is the first focusable element.

---

## 4. Component anatomy

| Component | Anatomy and rules |
|---|---|
| **Button** | `h-12` (md) / `h-14` (lg), `px-5`, `rounded-xl`, `text-base font-bold`, optional 20 px icon `gap-2`. Variants: primary, secondary (surface-2), ghost, danger, danger-outline. `aria-busy` + spinner while loading. Disabled = `aria-disabled` + 50 % opacity (still focusable, explained by its tooltip / text) |
| **IconButton** | 48 × 48, `rounded-xl`, 24 px icon, **required** `label` (becomes `aria-label` + title) |
| **Input** | Visible label above (`text-sm font-bold`), `h-12 rounded-xl border px-4 text-base`, hint below (`text-sm text-muted`), error = icon + text linked by `aria-describedby` + `aria-invalid`. Placeholder is never the label |
| **Chip** | `min-h-12 rounded-full px-4 border` + optional icon. Toggle chips use `aria-pressed`; multi-select groups use checkbox semantics (`role="checkbox"` in a `role="group"` with a label) |
| **Toggle** | Whole row is the target (`min-h-12`). `role="switch"` + `aria-checked`. Track 52 × 32, thumb 24. The state is also written ("On" / "Off") |
| **Tabs** | Segmented `rounded-xl bg-surface-2 p-1`, each tab `min-h-12`. WAI-ARIA tabs: roving tabindex, arrow keys (flipped in RTL), Home/End |
| **StatusBadge** | Pill `h-8 rounded-full ps-1 pe-3 gap-2`: **pattern swatch** (24 px circle: solid / diagonal stripes / dots) + icon (check / lock / users) + label. The swatch carries the pattern, so the label keeps full contrast |
| **Card** | `rounded-2xl border bg-card shadow-card p-5 desk:p-6`. Optional header (title `text-h3` + actions) and footer (divider) |
| **BottomSheet** | `rounded-t-3xl`, drag handle = 48 px button cycling the snap points (also arrow keys and Page Up/Down on the handle). `role="dialog"` when modal, otherwise a labelled `region`. Snap points: 25 / 55 / 92 % of the viewport |
| **SidePanel** | 400 px on the end side, `border-s`, header with title + close; overlay drawer below 1200 px (focus trap, Escape closes, focus returns to the opener) |
| **Dialog** | `rounded-2xl max-w-lg p-6 shadow-float`, focus trap, Escape, `aria-labelledby` / `aria-describedby`, scrim `bg-ink/50`, focus returns to the opener |
| **Toast** | `rounded-2xl` card with a leading status icon, text and an optional action. Region `aria-live="polite"` (errors: `assertive`). Stays 6 s, or until dismissed for errors; pauses on hover and focus. Mobile bottom (above the tab bar), desktop top-end |
| **Skeleton** | `rounded-xl bg-surface-2` blocks; shimmer only without reduced motion; the container has `aria-busy="true"` and a visually hidden "Loading…" |
| **EmptyState** | 64 px icon tile, `text-h3` title, `text-base text-muted` text, optional primary action; centred, `max-w-md` |

---

## 5. Conflicts resolved

| # | Image says | We do | Why |
|---|---|---|---|
| 1 | Purple, orange, pink and green palettes (images 1, 3, 6) | PROJECT_SPEC tokens only | Spec tokens win over images |
| 2 | 11–13 px text, uppercase micro-labels (1, 2, 6) | 16 px body, 14 px minimum, sentence case | Readability for low-vision and dyslexic users; Arabic has no case |
| 3 | ≈ 40–44 px controls (4, 6) | 48 px minimum everywhere | Spec target size |
| 4 | Status shown by colour only (table pills in 1, chart series in 6) | Icon + label + pattern on badges; dashes + markers on charts | Colour is never the only signal |
| 5 | Flags for languages (5) | Language names in their own script | Flags are countries, not languages |
| 6 | Floating panel on the left of the map (2) | Panel on the logical end side (right in LTR, left in RTL); a bottom sheet on mobile | Spec layout; RTL mirroring |
| 7 | Isometric 3D map (2) | Flat 2D floor plan + accessible list view | Legibility, CRS.Simple, screen readers |
| 8 | Glass / blur over photos (5) | Solid theme surfaces | Guaranteed contrast in all three themes |
| 9 | Separation by shadow only (3, 6) | Shadow + 1 px border; 2 px borders in high contrast | Low-vision users |
| 10 | "/" search shortcut (6) | `Ctrl K` / `⌘K` (spec) and `/` | Both; the hint shows `Ctrl K` |
| 11 | Lighter future bars (6) | Hatched pattern | Not colour only |
| 12 | Source route accent `#476C4C` is a forest line colour, not a UI text colour in every context | Route line uses `route`; route-coloured text uses the darker `route-text` `#324C35` where needed | Accessibility outranks raw source pairings; checked by `contrast.test.ts` |
| 13 | Photos in cards (3) and panels (2) | Icon tiles; no photos | No assets of our own; decorative photos add noise for screen readers |

---

## 6. Step 6 references (map page, find a room)

Two more images, again for look & feel only (no logos, names, photos or text copied).

| Observed | Implementation | Note |
|---|---|---|
| Map page: page title + subtitle, toolbar (building, floor, layers, Map / List segmented) | `Page description`; native selects (`Building`, `Floor`) + Layers button + Tabs | Selects show localised floor names from the level |
| Rooms tinted by status with an icon and the code in the room | Fill colour **+ SVG pattern** (solid / stripes / dots) + label tag with pattern swatch + icon + code | Spec icons (check / lock / group), not the image's own |
| Callout on the selected room "code · status · until time" | `.cw-callout` above the room (aria-hidden: the same text is in the marker's name and the panel) | Kept inside the visible map on resize |
| Controls top-end (zoom, locate), compass top-start, scale bottom | 48 px float IconButtons, "N" compass, Leaflet metric scale | |
| Legend bar under the map | `MapLegend` card: status swatches with patterns, closed passage, corridor, wall | |
| Right panel: title + status pill, stats, primary + secondary action, next classes, nearby rooms | `RoomDetail` in the shell's right panel (side panel / drawer / bottom sheet) | Valid `<dl>` for stats |
| Find a room: filter column, Cards / Table toggle, sort select, count, cards with photo, pagination | Filter card (desktop) / filter bottom sheet (phone); table with sortable headers (`aria-sort`) or cards; count in a status region; numbered pagination | **No photos** (resolved conflict 13); **no "Apply" button**: results update as filters change and the count is announced |
| Status radio list with coloured pills | Native radio group (label text, no colour-only pills) | |
| Route line from the user to the room | Not in this step (routing UI comes next) | |

---

## 7. Step 7 reference (navigation screen)

One image, look and feel only. The **instruction card layout** and the **step list structure** were taken; nothing else was copied (no logo, names, people or text).

| Observed | Implementation | Note |
|---|---|---|
| From / To fields side by side with a swap button, constraint chips, two option cards (radio) with time · distance and counts | `RoutePlanner`: two comboboxes + swap (48 px), toggle chips (`aria-pressed`), native radios inside the cards | Stacks on phones; From also has "My location / QR / Pick on the plan" |
| Floor selector chips over the map, route line, start dot, destination pin, elevator glyph, legend | Floor chips (`aria-pressed`) for the floors on the route; route colour on a card-coloured casing; transition tags "Elevator → Floor 1"; destination flag pin | Route line is decorative: the step list carries the same information |
| Right column: "To A-104" + time (distance), progress bar, step rows (tinted icon tile, bold title, muted subtitle, distance at the end, current row highlighted) | `RouteProgress` + `StepList`: `role="progressbar"` with a text value; `<ol>`, `aria-current="step"`, current row = tint **+ start border** (not colour only) | Turn arrows are physical directions: **not mirrored in RTL** |
| Bottom instruction bar: round arrow icon, big instruction + subtitle, divider, remaining time, distance, Stop | `InstructionBar`: `bg-ink text-canvas` (16:1 light, also dark/HC), 56 px icon, `text-2xl` instruction, "Then: …", danger-outline **Stop** (text + icon) | Bottom on desktop, top on phones (first thing seen) |
| "Report a problem here" disclosure | Secondary button → dialog (type radios, note, privacy text) | |
| "Start navigation" primary in the header | Two buttons under the options: **Start navigation** and **Start audio guidance** | Audio mode: forced high-contrast screen (not in the image) |
