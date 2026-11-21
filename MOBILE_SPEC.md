# accesU — React Native (Expo) Rebuild Specification

> Derived from the authoritative web client at `client/` and API at `server/`.
> Source-of-truth references are given as file paths throughout.
> This document is a technical specification for rebuilding the visual and functional layer as a React Native (Expo) application. Web behavior, state contracts, auth, routes, and accessibility requirements must be preserved.

---

## 1. Design Tokens & Styling

### 1.1 Token architecture

All color tokens are stored as **space-separated RGB channels** so alpha can be applied (`bg-primary/10` → `rgb(var(--c-primary) / 0.1)`). In React Native, map each channel triple to a hex string (or `rgb()` string) in a single `theme.ts` token object; alpha variants map to `rgba()`.

Source-of-truth files:

| Concern | File |
|---|---|
| Design tokens (colors, type, motion, shadows) | `client/src/styles/tokens.css` |
| Global CSS, focus ring, reduced motion | `client/src/styles/index.css` |
| Tailwind theme mapping | `client/tailwind.config.ts` |
| Theme switching / text scaling | `client/src/stores/preferences.ts` |
| Font loading | `client/src/main.tsx` |
| WCAG contrast contracts | `client/src/styles/contrast.test.ts`, `client/src/lib/contrast.ts` |
| Map-specific styling | `client/src/features/map/map.css` |
| Design narrative | `client/DESIGN_REFERENCE.md` |

Tailwind color aliases (`tailwind.config.ts:16-43`): `canvas`, `card`, `surface-2`, `ink`, `muted`, `line`, `line-strong`, `focus`, `primary`/`primary-800`/`primary-50`, `on-primary`, `route`/`route-100`/`route-text`, `available`/`available-bg`, `occupied`/`occupied-bg`, `club`/`club-bg`, `warning`/`warning-bg`, `danger`/`danger-bg` (aliases of occupied), `forest`/`forest-hover`, `olive`, `sage`, `soft`, `cream`.

### 1.2 Color palette — light theme (`:root`, `[data-theme='light']`)

| Token | HEX | RGB channels | Role |
|---|---|---|---|
| `--c-canvas` | `#F8FAF7` | `248 250 247` | page background |
| `--c-card` | `#FFFFFF` | `255 255 255` | card surface |
| `--c-surface-2` | `#F3F8E7` | `243 248 231` | secondary surface (cream) |
| `--c-ink` | `#26372A` | `38 55 42` | primary text |
| `--c-muted` | `#647064` | `100 112 100` | secondary text |
| `--c-line` | `#E4E9DF` | `228 233 223` | border |
| `--c-line-strong` | `#647064` | `100 112 100` | control border |
| `--c-focus` | `#476C4C` | `71 108 76` | focus ring |
| `--c-primary` | `#476C4C` | `71 108 76` | primary action (forest) |
| `--c-primary-800` | `#324C35` | `50 76 53` | primary dark |
| `--c-primary-50` | `#F3F8E7` | `243 248 231` | primary tint |
| `--c-on-primary` | `#FFFFFF` | `255 255 255` | text on primary |
| `--c-route` | `#476C4C` | `71 108 76` | route line |
| `--c-route-text` | `#324C35` | `50 76 53` | route text |
| `--c-route-100` | `#F3F8E7` | `243 248 231` | route tint |
| `--c-available` | `#15803D` | `21 128 61` | success / free |
| `--c-available-bg` | `#DCFCE7` | `220 252 231` | success fill |
| `--c-occupied` | `#B91C1C` | `185 28 28` | danger / occupied |
| `--c-occupied-bg` | `#FEE2E2` | `254 226 226` | occupied fill |
| `--c-club` | `#C2410C` | `194 65 12` | club status |
| `--c-club-bg` | `#FFEDD5` | `255 237 213` | club fill |
| `--c-warning` | `#B45309` | `180 83 9` | warning |
| `--c-warning-bg` | `#FEF3C7` | `254 243 199` | warning fill |
| `--c-forest` | `#476C4C` | `71 108 76` | brand |
| `--c-forest-hover` | `#3C5C40` | `60 92 64` | brand hover |
| `--c-olive` | `#7D9B5F` | `125 155 95` | brand |
| `--c-sage` | `#A4C6A4` | `164 198 164` | brand |
| `--c-soft` | `#CADCBC` | `202 220 188` | brand |
| `--c-cream` | `#F3F8E7` | `243 248 231` | brand |

### 1.3 Warm theme (`[data-theme='warm']`, default light resolution)

Identical to light except: `available #10B981`, `available-bg #ECFDF5`, `occupied #EF4444`, `occupied-bg #FEF2F2`, `club #D97706`, `club-bg #FEF3C7`, `warning #D97706`, `warning-bg #FEF3C7`.

### 1.4 Dark theme (`[data-theme='dark']`)

| Token | HEX | Token | HEX |
|---|---|---|---|
| `--c-canvas` | `#1E2E21` | `--c-route` | `#A4C6A4` |
| `--c-card` | `#273C2A` | `--c-route-text` | `#CADCBC` |
| `--c-surface-2` | `#324C35` | `--c-route-100` | `#324C35` |
| `--c-ink` | `#F3F8E7` | `--c-available` | `#4ADE80` |
| `--c-muted` | `#CADCBC` | `--c-available-bg` | `#0F2E1C` |
| `--c-line` | `#476C4C` | `--c-occupied` | `#FCA5A5` |
| `--c-line-strong` | `#A4C6A4` | `--c-occupied-bg` | `#3A1214` |
| `--c-focus` | `#A4C6A4` | `--c-club` | `#FDBA74` |
| `--c-primary` | `#A4C6A4` | `--c-club-bg` | `#3A1D0C` |
| `--c-primary-800` | `#7D9B5F` | `--c-warning` | `#FCD34D` |
| `--c-primary-50` | `#324C35` | `--c-warning-bg` | `#3A2A0A` |
| `--c-on-primary` | `#1E2E21` | static brand colors | unchanged from light |

### 1.5 High-contrast theme (`[data-theme='hc']`)

Black / white / yellow only. No greys, no shadows, 2px borders.

- Backgrounds (`canvas`, `card`, `surface-2`, `primary-50`, `route-100`, `on-primary`, status fills): `#000000`
- Text/borders (`ink`, `muted`, `line`, `line-strong`, `available`, `occupied`, `club`, `soft`): `#FFFFFF`
- Focus, primary, primary-800, route, route-text, warning, forest, olive, sage: `#FFD60A`
- `cream`: `#000000`; shadows: `none`; `--border-w: 2px`
- Map HC overrides (`map.css`): `#FFFFFF` strokes, `#FFD60A` pins/selected-room/me-dot, `#000000` backgrounds/icons.

The runtime status-bar / theme-color meta is `#476C4C` (light/warm), `#1E2E21` (dark), `#000000` (hc) — `stores/preferences.ts:86-87`.

### 1.6 Typography

Fonts (self-hosted via `@fontsource`, `client/src/main.tsx:1-4`):

- **Atkinson Hyperlegible** — weights 400, 700 (latin, latin-ext)
- **IBM Plex Sans Arabic** — weights 400, 700 (arabic, latin, latin-ext)

Families (`tailwind.config.ts:44-47`):

```ts
sans:   ['Atkinson Hyperlegible', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif]
arabic: ['IBM Plex Sans Arabic', 'Atkinson Hyperlegible', system-ui, sans-serif]
```

Expo equivalent: `expo-font` loading the packaged `.woff2`/`.ttf` files; select the Arabic family when `lang === 'ar'`.

Type scale (rem; root font size follows user text scale 100–200%):

| Class | Size / line height |
|---|---|
| `text-sm` | 14 / 20 px |
| `text-base` | 16 / 24 px |
| `text-lg` | 18 / 26 px |
| `text-xl` | 20 / 28 px |
| `text-2xl` | 24 / 32 px |
| `text-3xl` | 32 / 40 px |
| `text-4xl` | 44 / 52 px |
| `text-h3` | 18 / 26 px, weight 700 |
| `text-h2` | 20 / 28 px mobile, 22 / 30 px desktop, weight 700 |
| `text-h1` | 24 / 32 px mobile, 28 / 36 px desktop, weight 700 |
| `text-display` | 30 / 38 px mobile, 36 / 44 px desktop, weight 700 |
| `text-kpi` | 28 / 36 px mobile, 32 / 40 px desktop, weight 700 |

Weights used in practice: 400 body, 700 headings/labels (decorative SVG uses 900). Config declares 400/500/600/700/800/900.

### 1.7 Radii, spacing, shadows, focus

**Radii** (`tailwind.config.ts:66`): `lg=8px`, `xl`/`control=12px`, `2xl`/`card=16px`, `3xl=24px`, `full=9999px`. Controls use `control`, cards/dialogs `card`, bottom sheets `3xl`.

**Spacing** (`tailwind.config.ts:78-80`): standard 4px Tailwind scale plus `18=72px`, `sidebar=240px`, `rail=72px`, `panel=400px`, and minimum target `3rem = 48px`. Guidance: 4px grid; card padding 20px mobile / 24px desktop; page padding 16/24px; gaps 12–16 mobile, 16–24 desktop; list rows ≥56px.

**Shadows**:

| Theme | Card | Float |
|---|---|---|
| light / warm | `0 1px 2px rgb(38 55 42 / .05), 0 4px 12px rgb(38 55 42 / .06)` | `0 10px 28px rgb(38 55 42 / .16)` |
| dark | `0 1px 2px rgb(0 0 0 / .4)` | `0 8px 32px rgb(0 0 0 / .5)` |
| hc | `none` | `none` |

**Focus ring**: 3px solid `--c-focus` with 2px offset; 4px in high contrast. Never suppress except on programmatically focused headings.

**Motion**: `--dur-fast=150ms`, `--dur-sheet=250ms`, `cubic-bezier(.32,.72,0,1)` for sheets. Reduced motion sets all durations to `0.01ms` and disables route animation.

**Breakpoints**: `sm=640`, `tablet=768`, `desk=1200`. On mobile use phone/tablet tiers only.

**z-index**: bar 30, sheet 40, overlay 50, toast 60.

### 1.8 Global utilities / patterns to port

From `index.css`: `.border-theme`, `.border-control`, `.pattern-solid`, `.pattern-stripes`, `.pattern-dots`, `.pattern-hatch` (status color independence), `.skeleton-shimmer`, `.card-interactive`, `.floating-dock`, `.animate-fade-in`, `.sr-only-focusable`, `.tabular`, `.pb-safe`, `.flip-rtl` (RTL mirroring). Keyframes `shimmer` and `fade-in`.

### 1.9 Accessibility acceptance criteria (WCAG 2.2 AA)

- Minimum interactive target **48×48 px**; list rows ≥56px.
- Body text ≥16px; no text below 14px.
- Text contrast ≥4.5:1; UI/border/focus ≥3:1 — enforced by `contrast.test.ts` in all themes.
- Focus ring 3px (4px HC), skip link + landmarks, modal focus traps (`src/a11y/focus.ts`), polite live regions.
- Text scale 100–200% in 25% steps; layout reflows using effective width (viewport ÷ scale).
- Reduced motion honored from OS or app setting.
- RTL for Arabic with logical spacing, mirrored arrows, non-mirrored turn indicators.
- Status always conveyed by color **plus** icon/label/pattern.

---

## 2. Asset Inventory

### 2.1 Icon set

- Library: **`lucide-react` v1.66.0** (`client/package.json:24`). No other icon package is imported.
- 118 distinct Lucide icon components are used, plus the `LucideIcon` TypeScript type and `createLucideIcon` factory.
- Two custom Lucide-based icons are generated in `client/src/features/map/icons.tsx:6-11`: `StairsIcon` (`cw-stairs`) and `ElevatorIcon` (`cw-elevator`).
- Expo equivalent: `lucide-react-native` (same names, RN SVG primitives) or `@expo/vector-icons` mappings; recreate the two custom icons with `react-native-svg`.

Key icon groups by feature (source file → icons):

| Area | Files | Icons used |
|---|---|---|
| Shell / UI | `components/shell/AppShell.tsx`, `CommandPalette.tsx`, `Controls.tsx`, `nav.ts`, `components/ui/*` | `Menu`, `Search`, `X`, `PanelLeftClose`, `PanelLeftOpen`, `Building2`, `DoorOpen`, `Users`, `Accessibility`, `Contrast`, `Languages`, `LogIn`, `LogOut`, `Moon`, `Settings`, `Sparkles`, `Sun`, `SunMoon`, `UserRound`, `ShieldCheck`, `LayoutGrid`, `Map`, `MessagesSquare`, `MoreHorizontal`, `Navigation`, `Palette`, `Loader2`, `Check`, `AlertTriangle`, `RotateCw`, `AlertCircle`, `CircleCheck`, `GraduationCap`, `Lock`, `CheckCircle2`, `Info`, `Bell`, `Mail`, `MapPin` |
| Pages | `pages/LandingPage.tsx`, `LoginPage.tsx`, `OnboardingPage.tsx`, `SettingsPage.tsx`, `PlaceholderPages.tsx`, `DesignSystemPage.tsx`, `AdminPage.tsx`, `TalkPage.tsx` | `Accessibility`, `ArrowRight`, `AudioLines`, `Captions`, `Languages`, `LogIn`, `Route`, `ShieldCheck`, `Signal`, `Eye`, `EyeOff`, `Mail`, `Sparkles`, `ArrowLeft`, `Check`, `Ear`, `Eye`, `MessageSquareText`, `PersonStanding`, `Contrast`, `Moon`, `Pencil`, `Sun`, `SunMoon`, `Compass`, `Palette`, `Settings`, `ArrowUp`, `Bell`, `DoorOpen`, `MapPin`, `Plus`, `Search`, `Trash2`, `TrendingUp`, `Users`, `AlertTriangle`, `CheckCircle2`, `Compass`, `Download`, `FileCode`, `RotateCcw`, `Shield`, `ShieldAlert`, `Upload`, `ZoomIn`, `ZoomOut`, `AlertCircle`, `Copy`, `GraduationCap`, `MessageSquare`, `MessagesSquare`, `Mic`, `MicOff`, `Sparkles`, `Trash2`, `Type`, `Volume2`, `VolumeX` |
| Map / floor plans | `features/map/MapPage.tsx`, `MapControls.tsx`, `MapListView.tsx`, `FloorMap.tsx`, `IsometricCampusMap.tsx`, `icons.tsx` | `Boxes`, `Building2`, `Layers`, `List`, `Map`, `Ban`, `DoorOpen`, `Locate`, `Minus`, `Plus`, `Bookmark`, `Download`, `FileCode`, `Maximize2`, `Navigation`, `RotateCcw`, `Share2`, `X`, `ZoomIn`, `ZoomOut`, `Accessibility`, `CircleParking`, `Flag`, `Info`, `Landmark`, `Toilet`, `TrendingUp`, plus custom `StairsIcon`, `ElevatorIcon` |
| Navigate | `features/navigate/RoutePlanner.tsx`, `NavigatePage.tsx`, `NavigationView.tsx`, `AudioNavigation.tsx`, `PositionPanel.tsx`, `PlaceSearch.tsx`, `QrCheckpointDialog.tsx`, `ReportProblem.tsx`, `RouteMap.tsx`, `stepIcons.ts` | `Accessibility`, `AlertTriangle`, `BookOpen`, `Building`, `Coffee`, `DoorOpen`, `FlaskConical`, `GraduationCap`, `Headphones`, `MapPinned`, `Navigation`, `Presentation`, `QrCode`, `Search`, `SlidersHorizontal`, `X`, `Zap`, `CheckCircle2`, `PanelLeftClose`, `PanelLeftOpen`, `RotateCcw`, `Clock`, `Route`, `Square`, `Eye`, `Pause`, `Play`, `Repeat2`, `Crosshair`, `LocateFixed`, `Satellite`, `Shuffle`, `MapPin`, `Flag`, `Send`, `ArrowUp`, `ArrowUpLeft`, `ArrowUpRight`, `CircleDot`, `CornerUpLeft`, `CornerUpRight`, `LogOut`, `TrendingUp`, `Undo2` |
| Rooms / sharing | `features/rooms/RoomsPage.tsx`, `RoomDetail.tsx`, `features/sharing/SharingControl.tsx` | `Accessibility`, `ArrowDown`, `ArrowUp`, `ArrowUpDown`, `Bookmark`, `BookmarkCheck`, `ChevronLeft`, `ChevronRight`, `DoorOpen`, `Footprints`, `GraduationCap`, `LayoutGrid`, `Megaphone`, `Navigation`, `Shield`, `SlidersHorizontal`, `Table2`, `Users`, `Ear`, `MapPin`, `ShieldCheck` |

### 2.2 Brand assets and static graphics

| Exact path | Description | Current usage |
|---|---|---|
| `client/public/brand/accesu-logo-black.jpg` | Black accesU wordmark/logotype (545×375) | Expanded sidebar logo in `client/src/components/shell/Logo.tsx:18` |
| `client/public/brand/accesu-mark-black.jpg` | Black accesU compact mark (340×230) | Collapsed rail / compact logo in `client/src/components/shell/Logo.tsx:5` |

Build copies (`client/dist/brand/*`) are generated and are not source assets.

Not present in the web app:

- `client/src/assets/**` does not exist; no imported local illustrations, badges, or placeholder images.
- No `.svg` files under `client/public` or `client/src`.
- No favicon and no `<link rel="icon">` in `client/index.html`.
- No social/OG images or manifest icons.
- No local hero image, empty-state illustration, or placeholder graphics.

Remote images used at runtime (`client/src/features/map/IsometricCampusMap.tsx`, `ISO_BUILDINGS`, selected-building card):

```text
https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=80  (restaurant/café)
https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=600&auto=format&fit=crop&q=80  (building B / lecture halls)
https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=600&auto=format&fit=crop&q=80  (building A / sciences)
https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&auto=format&fit=crop&q=80  (sports complex)
https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&auto=format&fit=crop&q=80  (administration)
```

Use `expo-image` with these URLs, or bundle equivalent local images for offline reliability.

Server-provided graphic:

- `server/data/floor_svgs/cmwp5198j0006uxmoz91l6qcx.svg` — VTracer-generated architectural floor plan; fetched via `GET /api/admin/floors/:floorId/svg` and injected via `dangerouslySetInnerHTML` in `IsometricCampusMap.tsx` and `AdminPage.tsx`. Raw HTML injection is unavailable in RN; use WebView, sanitizer + `react-native-svg`, or server-side rasterization.

### 2.3 Fonts

Packages: `@fontsource/atkinson-hyperlegible` **5.3.0**, `@fontsource/ibm-plex-sans-arabic` **5.3.0**.

Loaded in `client/src/main.tsx:1-4`:

```ts
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
```

Exact source font files are in:

```text
client/node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-{latin,latin-ext}-{400,700}-normal.{woff2,woff}
client/node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-{arabic,latin,latin-ext,cyrillic-ext}-{400,700}-normal.{woff2,woff}
```

Expo: copy the needed `.woff2`/`.ttf` files into `assets/fonts/` and load with `expo-font`. Only 400 and 700 are real fonts; other declared weights are synthesized.

### 2.4 Inline SVG / procedural visuals to recreate

| Component | Source | What it draws | RN approach |
|---|---|---|---|
| Isometric campus map | `client/src/features/map/IsometricCampusMap.tsx:757-1092` (`viewBox="0 0 1200 820"`) | Roads, crosswalks, park/lake, ~26 procedural trees, two sports courts, five isometric buildings, floor bands, badges, gradients/filters | `react-native-svg` + gesture handlers, or pre-render static artwork and overlay interactive hit areas |
| Generated fallback floor-plan SVG | `client/src/features/map/IsometricCampusMap.tsx:283-442` (`viewBox="0 0 1020 640"`) | Status-colored rooms, emoji badges, elevators/WC/exits, curved route, pins, tooltip | Procedurally generate with RN SVG from room/plan data |
| Server floor SVG | `IsometricCampusMap.tsx:688,1275`; `AdminPage.tsx:955` | External architectural SVG | WebView or sanitizer → `react-native-svg`; no `dangerouslySetInnerHTML` |
| Leaflet floor plan | `client/src/features/map/FloorMap.tsx`, `map.css` | Footprints, walls, paths, room overlays, route polylines, markers, labels | Custom `react-native-svg` renderer with `react-native-gesture-handler` / `react-native-reanimated` |
| Custom pins | `client/src/features/map/icons.tsx:39-60` | 36×44 teardrop pin, icon, wheelchair badge via `renderToStaticMarkup` and HTML strings | RN SVG pin components; no static HTML markup |
| Small inline SVGs | `FloorMap.tsx:542-545,562-564`, `MapControls.tsx:112-114`, `ui/CircularGauge.tsx:35-66`, `ui/Input.tsx:106-108` | Crosshair, north arrow, legend dash, circular gauge, select chevron | Recreate with `react-native-svg`/icons |
| Status patterns | `styles/index.css:75-94`, `features/map/map.css:76-89` | Solid / stripes / dots / hatch textures | RN SVG `<Pattern>` or tiled Views; preserve color-independent status encoding |

### 2.5 Asset migration checklist

1. Copy both brand JPGs into the Expo app and use `expo-image` for the logo/mark.
2. Add a favicon/app icon and adaptive icon assets (absent on web, required for native).
3. Bundle fonts with `expo-font`; keep separate families for Latin and Arabic.
4. Replace `lucide-react` with `lucide-react-native`; recreate `StairsIcon` and `ElevatorIcon`.
5. Replace Unsplash URLs with bundled images or cached `expo-image` sources.
6. Choose a strategy for server floor SVGs and the isometric SVG (WebView vs `react-native-svg` renderer vs pre-rendered bitmap overlays).

---

## 3. Screens & Navigation Map

### 3.1 Web route inventory (authoritative — `client/src/App.tsx`)

| Web route | Screen / component | Source file | Access notes |
|---|---|---|---|
| `/` | `LandingPage` | `client/src/pages/LandingPage.tsx` | Public |
| `/login` | `LoginPage` | `client/src/pages/LoginPage.tsx` | Public; redirects away if already signed in |
| `/onboarding` | `OnboardingPage` | `client/src/pages/OnboardingPage.tsx` | Public; `ADMIN` → `/admin`, `TEACHER` → `/rooms` after wizard routing logic |
| `/map` | `MapPage` | `client/src/features/map/MapPage.tsx` | Public, inside app shell |
| `/rooms` | `RoomsPage` | `client/src/features/rooms/RoomsPage.tsx` | Public, inside app shell |
| `/navigate` | `NavigatePage` | `client/src/features/navigate/NavigatePage.tsx` | Public; hidden from nav for `TEACHER`, `CLUB`, `ADMIN` |
| `/talk` | `TalkPage` | `client/src/pages/TalkPage.tsx` | Public; hidden from nav for `TEACHER`, `CLUB`, `ADMIN` |
| `/admin` | `AdminPage` | `client/src/pages/AdminPage.tsx` | Component-level `ADMIN` check; non-admin sees restricted panel |
| `/more` | `MorePage` | `client/src/pages/PlaceholderPages.tsx` | Public, inside app shell |
| `/settings` | `SettingsPage` | `client/src/pages/SettingsPage.tsx` | Public, inside app shell |
| `/profile` | `ProfilePage` / `ProfileWizard` | `client/src/pages/PlaceholderPages.tsx`, `client/src/pages/OnboardingPage.tsx` | Public; same role redirects as onboarding |
| `/design-system` | `DesignSystemPage` | `client/src/pages/DesignSystemPage.tsx` | Public, inside app shell |
| `/home` | `<Navigate to="/map" replace />` | `client/src/App.tsx` | Legacy alias → `/map` |
| `*` | `NotFoundPage` | `client/src/pages/PlaceholderPages.tsx` | Catch-all 404 |

**Gating nuance:** the web app has no router-level auth guard. Role behavior is UI-level: `client/src/components/shell/nav.ts` controls visible nav items; `LoginPage` chooses the post-login destination; only `AdminPage` performs an explicit role check. Deep links are reachable by URL. The RN rebuild should add a `useRoleGate(allowedRoles)` guard at the navigator layer for Navigate, Talk, and Admin.

### 3.2 Current web navigation shell

Source: `client/src/components/shell/AppShell.tsx`, `nav.ts`, `Controls.tsx`, `Page.tsx`, `RightPanel.tsx`, `CommandPalette.tsx`.

- **Desktop (≥1200px):** fixed 240px sidebar (72px collapsed) with brand, nav groups ("Campus" / "Vous"), collapse toggle, main area, optional inline 400px right panel.
- **Tablet (≈768–1199px):** 72px icon rail, slide-in nav drawer, right panel as overlay drawer.
- **Mobile (<768px):** top bar with menu, search, language/floor controls; floating bottom tab bar with five primary items; right panel as modal bottom sheet.
- **Page wrapper:** every screen uses `<Page title description>` — sets document title, renders `<h1>`, moves focus to heading on route change.
- **Command palette:** Ctrl/⌘+K or `/` opens a WAI-ARIA combobox/listbox dialog searching rooms, buildings, POIs, clubs, and pages. Selecting a room navigates to `/rooms?code=A-104`.
- **Top controls:** theme cycle, language select, floor select, profile/account menu (guest → sign in; signed in → name, settings, sign out).
- **Right panel:** context provider `useRightPanel()` with `open({title, body})`; used by Map, Rooms, Admin for `RoomDetail`.

Overlay primitives to reproduce semantically in RN (`client/src/a11y/focus.ts`, `client/src/components/ui/`): focus trap + inert background, `Dialog`, `BottomSheet` (snap points peek/half/full), `SidePanel`, skip link, global `Announcer`, `Toast`.

Feature-specific overlays: `QrCheckpointDialog`, `ReportProblem`, sharing-consent `Dialog`, place-search dialogs, mobile room-filter sheet, global command palette.

### 3.3 Recommended Expo / React Native navigation structure

```text
RootStack (native-stack, headerShown: false)        ← Providers: Query, Auth, Socket, Preferences
 ├─ Landing                    (/)
 ├─ Login                      (/login)
 ├─ Onboarding                 (/onboarding)         role redirects
 ├─ NotFound                   (*)
 └─ AppTabs (bottom-tabs, 5 tabs)                   mirrors mobile web bottom bar
     ├─ Map                    (/map)
     │    └─ RoomDetail        modal/bottom sheet    right-panel equivalent
     ├─ Rooms                  (/rooms)
     │    └─ RoomDetail        modal/bottom sheet
     ├─ Navigate               (/navigate)
     │    ├─ Planner
     │    ├─ Guidance (visual)
     │    ├─ AudioGuidance     full-screen modal, forced HC
     │    └─ Arrival
     ├─ Talk                   (/talk)
     └─ More                   (/more)
          ├─ Settings          (/settings)
          ├─ Profile           (/profile)
          ├─ DesignSystem      (/design-system)
          └─ Admin             (/admin, conditional ADMIN)
```

Implementation guidance:

- Use `@react-navigation/native-stack` + `@react-navigation/bottom-tabs`.
- Present `RoomDetail`, `CommandPalette`, `QrCheckpointDialog`, `ReportProblem`, and sharing consent as native modals / transparent modals / bottom sheets.
- Keep role guards in the navigator; do not rely on hidden tabs alone.
- For tablets/iPads, optional split-view can reproduce the inline right panel; phones should always use a sheet/modal.
- Replace web heading focus with `AccessibilityInfo` focus on screen entry; replace live regions with `AccessibilityInfo.announceForAccessibility`.

**Deep links to mirror:**

```text
/home → /map
/map?room=A-104
/map?poi=<id>
/map?building=A
/map?view=campus
/map?mode=list|iso
/rooms?status=…&building=…&floor=…&min=…&max=…&stepFree=1&sort=…&page=…&view=cards|table&code=A-104
/navigate?to=room:A-104&from=poi:<id>&at=<checkpoint>&mode=audio
```

### 3.4 Core user flows

#### Authentication / login — `client/src/pages/LoginPage.tsx`

1. Email + password form.
2. Demo quick-fill chips set one of `admin@campusway.local`, `benali@campusway.local`, `yacine@campusway.local`, `riad@campusway.local`; password is injected via `__DEMO_PASSWORD__`.
3. Submit updates the auth store with user role and `accessibilityProfile`.
4. Post-login routing: `ADMIN` → `/admin`; `TEACHER` → `/rooms`; no saved profile → `/onboarding`; otherwise `location.state.from ?? '/map'`.
5. Guests may still use Map, Rooms, Talk; saving preferences requires sign-in.

#### Onboarding / profile — `client/src/pages/OnboardingPage.tsx`, `client/src/features/profile/model.ts`

1. Steps: `needs` → `preferences` → `review`.
2. Needs: multi-select `WHEELCHAIR`, `REDUCED_MOBILITY`, `BLIND_LOW_VISION`, `DEAF_HARD_OF_HEARING`, `SPEECH`, `NONE`.
3. Preferences: audio guidance, high contrast, large text, step-free routing, with live preview.
4. Review + save: signed-in users persist to server profile; anonymous users get an info toast.
5. Same wizard is reused for `/profile`; role redirects apply.

#### Map exploration — `client/src/features/map/MapPage.tsx`

1. Toolbar: building select, floor select, layers, view tabs Map / List / Iso.
2. Default floor: first building's level 0; stored in preferences.
3. Deep links auto-select room/POI/building; campus-scope POIs switch to isometric view.
4. Selecting a room/POI updates the URL and opens `RoomDetail`; closing clears selection.
5. Live statuses via `useLiveFloors`; selected-room changes announced politely.
6. Isometric view can open `/navigate?to=<target>` or switch to floor-plan mode.
7. List view can focus the corresponding map marker.

#### Room search / detail — `client/src/features/rooms/RoomsPage.tsx`, `RoomDetail.tsx`

1. Filters live in URL: status, building, floor, capacity min/max, step-free, sort, page, view.
2. Results update immediately; count announced politely.
3. Desktop table / mobile cards; 12 results per page.
4. Selecting a result opens `RoomDetail`; `?code=A-104` auto-opens from command palette.
5. Detail shows live status, timeline, accessibility info, nearby step-free facilities, nearby rooms, "Get directions" → `/navigate?to=room:<code>`, bookmark, and teacher/club reservation actions.

#### Route planning + guided navigation — `client/src/features/navigate/`

1. Plan phase: full-bleed `RouteMap` with collapsible planner panel; from/to `PlaceSearch` supports rooms, POIs, and "here"; pick-on-map and QR checkpoint available.
2. Accessibility needs derived from profile; user can choose fastest or step-free PMR options.
3. `POST /api/routes/plan` returns route options; selected option previews a track polyline.
4. Start sets nav phase to navigating, selects audio if requested/profile-driven, and speaks first instruction.
5. Visual guidance: large instruction bar, map follow + floor switch, step list/progress, reroute alerts, sharing control, report problem.
6. Audio guidance: forced high contrast, huge text, Repeat / Where am I / Pause controls; all messages mirrored in live region.
7. Controller handles progress, recheck on movement, `route:invalidated` reroute, arrival detection, demo simulator, and sharing logs.
8. Speech: server Cartesia TTS via `POST /api/speech/tts` when available and signed in; browser `speechSynthesis` fallback.
9. Arrival: success summary, map/room links, again/done.

#### Talk — `client/src/pages/TalkPage.tsx`

1. Tabs: sound-to-text (Web Speech API; `fr-FR`, `en-US`, `ar-DZ`), text-to-sound (AAC phrases + TTS), dialogue view.
2. Expo requires `expo-speech` for TTS and a native/cloud STT solution for recognition.
3. Several currently hardcoded French strings should be extracted to i18n during the port.

#### Admin — `client/src/pages/AdminPage.tsx`

1. Role check; non-admin sees restricted panel with link to `/map`.
2. Tabs: occupancy, mobility, SVG.
3. Occupancy: metric cards, building filter, room table, `RoomDetail`.
4. Mobility: admin stats, recommendation review/approve, recent hotspots.
5. SVG: upload/download floor SVG, zoom, PRM route optimizer simulator.

#### Settings / profile — `client/src/pages/SettingsPage.tsx`

1. Appearance: theme (`system`, `light`, `dark`, `hc`; warm is branded default), text scale 1–2 step 0.25, motion (`system`, `reduce`, `full`).
2. Language switch updates both preference store and i18n instance.
3. Accessibility profile link, privacy/sharing, sign out (local or all sessions).

### 3.5 i18n & RTL requirements

- Languages: `ar`, `fr`, `en`; names `العربية`, `Français`, `English`.
- Resolution: saved preference → browser languages → default/fallback `fr` (`client/src/i18n/index.ts`).
- Locale files: `client/src/i18n/locales/{en,fr,ar}.ts`, typed by `Messages` from `en.ts`.
- Preferences persisted by Zustand under `campusway.preferences` (version 1).
- `applyPreferences()` writes theme, motion, root font size, `lang`, and `dir`; `RTL_LANGS = ['ar']`.
- System listeners: `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion`.

Expo/RTL guidance:

- Use `I18nManager.allowRTL(true)` and `I18nManager.forceRTL(lang === 'ar')`; RN requires a restart after changing RTL.
- Replace logical CSS (`ps-5`, `pe-1`, `start-3`, `ms-auto`) with RTL-aware `paddingStart`, `marginStart`, `insetInlineStart` helpers or conditional values.
- Mirror directional icons (chevrons, back, panel open/close, sort arrows); do **not** mirror turn arrows in navigation instructions.
- Align speech locales: web speech uses `{ ar: 'ar-DZ', fr: 'fr-FR', en: 'en-GB' }`; Talk STT uses `ar-DZ` / `fr-FR` / `en-US`.
- Port `client/src/lib/format.ts` number/date/duration formatting with `Intl` / `expo-localization`.
- Move remaining hardcoded French strings in Map empty states, Admin, Navigate planner toggle, and Talk into the three locale files.

### 3.6 Navigation acceptance checklist

1. Root stack, tab group, and modal screens reproduce all web routes without adding `/auth/*`, `/admin/dashboard`, or `/student/*` routes.
2. Role guards exist at navigator level for Navigate, Talk, Admin.
3. Deep links and query parameters above restore the same screen state.
4. Modals trap focus semantically and close with Android back / Escape-equivalent.
5. Screen-entry accessibility focus and announcements are implemented.
6. Theme/language/text-scale/motion preferences persist and apply before first render.
7. RTL layout and icon mirroring verified in Arabic.

---

## 4. API & Data Layer

### 4.1 Base URL, proxy, environment, and HTTP client

**Client HTTP setup** (`client/src/api/client.ts`):

```ts
axios.create({ baseURL: '/', withCredentials: true, timeout: 15_000 })
```

- All web calls are same-origin relative paths.
- Request interceptor attaches `Authorization: Bearer <accessToken>` from `useAuth` and `Accept-Language: <lang>` from i18n.
- Refresh uses raw `axios.post('/api/auth/refresh', …, { withCredentials: true, timeout: 10_000 })`.
- Concurrent 401s share one in-flight refresh promise.
- Retry only on `401` with `INVALID_TOKEN` / `UNAUTHORIZED`, excluding `/api/auth/*`, once per request.
- `errorCode(err)` → `NETWORK`, `HTTP_<status>`, API `error.code`, or `UNKNOWN`.

**Dev proxy** (`client/vite.config.ts`):

```ts
server: {
  host: true,
  port: 5174,
  proxy: {
    '/api': apiTarget,
    '/health': apiTarget,
    '/socket.io': { target: apiTarget, ws: true },
  },
}
```

- `apiTarget = env.API_PROXY_TARGET ?? 'http://localhost:4000'`.
- API default port: `4000`. Web client actual dev port: `5174` (some docs mention `5173`).
- Expo adaptation: replace relative `baseURL: '/'` with absolute `EXPO_PUBLIC_API_URL`; add the same path prefixes for HTTP and Socket.io.

**Production assumptions:**

1. Reverse-proxy `/api`, `/health`, `/socket.io` (with WebSocket upgrade) to the API.
2. Use HTTPS so the refresh cookie (`secure: true` in production) is sent.
3. Set server `CORS_ORIGINS` if cross-origin.
4. Provide distinct secrets: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PSEUDONYM_SECRET` (≥32 chars each).
5. Helmet CSP defaults apply in production; dev disables `upgradeInsecureRequests`.

**Key env vars:**

| Side | Variable | Default / notes |
|---|---|---|
| client | `API_PROXY_TARGET` | `http://localhost:4000` |
| client | `VITE_CAMPUS_GEOREF` | `"lat,lng,rotationDeg"` for campus origin |
| client | `VITE_LOG_SIMULATED_POSITIONS` | `false` |
| client | `VITE_DEMO_PASSWORD` | optional override; falls back to `SEED_PASSWORD` from `server/.env`, then `campusway-demo`; exposed as `__DEMO_PASSWORD__` |
| server | `PORT` | `4000` |
| server | `DATABASE_URL` | required PostgreSQL + PostGIS |
| server | `JWT_ACCESS_EXPIRES_IN` | `15m` |
| server | `JWT_REFRESH_EXPIRES_IN_DAYS` | `7` |
| server | `CORS_ORIGINS` | comma-separated origins |
| server | `CARTESIA_API_KEY`, voices | optional server TTS |
| server | `SEED_PASSWORD`, `SEED_RANDOM` | seed-only |

Expo replacements: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CAMPUS_GEOREF`, `EXPO_PUBLIC_LOG_SIMULATED_POSITIONS`, and app `extra` / `expo-constants` for demo password.

### 4.2 Authentication model

Source: `server/src/modules/auth/tokens.ts`, `auth.router.ts`, `auth.schemas.ts`.

- JWT **HS256**, issuer `campusway`.
- Access token audience `campusway-api`; payload `{ role, typ: 'access', sub: userId }`; default expiry `15m`.
- Refresh token audience `campusway-refresh`; payload `{ ver: tokenVersion, typ: 'refresh', sub: userId }`; default `7` days.
- Refresh cookie: `cw_rt`, path `/api/auth`, `httpOnly`, `sameSite: 'strict'`, `secure` in production.
- Access verification whitelist: `STUDENT | TEACHER | ADMIN` (role enum also has `CLUB`).
- `logout-all` increments `User.tokenVersion`, invalidating all refresh tokens.

```ts
AuthSession = {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number       // seconds
  user: Me                // never includes refresh token
}
```

### 4.3 Server HTTP conventions

Source: `server/src/app.ts`, `server/src/http/route.ts`, `server/src/lib/i18n.ts`, `server/src/middleware/rateLimit.ts`.

- Global: Helmet, CORS credentials, JSON body limit 1 MB, cookie parser, pino logging.
- Mounted under `/api`: `auth`, `me`, `campus`, `rooms`, `reservations`, `routes`, `mobility`, `speech`, `ai`, `admin`.
- One Zod spec per route drives auth, role guard, validation, response DTO, and OpenAPI.
- Request validation collects all issues into `400 VALIDATION_ERROR`.
- Responses are `safeParse`d and unknown keys stripped; drift → `500 INTERNAL_ERROR`.
- Language: `?lang=` → valid `Accept-Language` → `fr`.
- Rate limits: global `300/60s`; login/register `20/15min`; TTS `60/60s`.

### 4.4 Endpoint catalog

#### Auth & me

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/auth/register` | public | `201 AuthSession` |
| POST | `/api/auth/login` | public | `200 AuthSession` |
| POST | `/api/auth/refresh` | refresh cookie | `200 AuthSession` |
| POST | `/api/auth/logout` | public | `204` |
| POST | `/api/auth/logout-all` | required | `204` |
| GET | `/api/me` | required | `Me` |
| PUT | `/api/me` | required | `Me` |
| GET | `/api/me/accessibility-profile` | required | `AccessibilityProfile` |
| PUT | `/api/me/accessibility-profile` | required | `AccessibilityProfile` |

```ts
RegisterBody = {
  email: string            // max 254
  password: string         // 10..128
  displayName: string      // 2..80
  locale?: 'ar' | 'fr' | 'en'
}
LoginBody = { email: string; password: string } // password 1..128

User = {
  id: string; email: string; displayName: string
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CLUB'
  locale: 'ar' | 'fr' | 'en'
  createdAt: string
}
Me = User & { accessibilityProfile: AccessibilityProfile }

AccessibilityProfile = {
  mobility: 'NONE' | 'WHEELCHAIR' | 'REDUCED_MOBILITY' | 'BLIND_LOW_VISION'
          | 'DEAF_HARD_OF_HEARING' | 'SPEECH'
  stepFree: boolean
  requireVerifiedRamps: boolean
  maxSlopePercent: number | null        // 0..20
  minPassageWidthCm: number | null      // int 50..250
  avoidClosedPassages: boolean
  audioGuidance: boolean
  shorelineHints: boolean
  captions: boolean
  textToSpeech: boolean
  highContrast: boolean
  reducedMotion: boolean
  textScale: number                     // 1..2
  updatedAt: string | null
}
UpdateMeBody = { displayName?: string; locale?: Lang } // ≥1 field
UpdateAccessibilityProfile = Partial<Omit<AccessibilityProfile, 'updatedAt'>> // strict, ≥1
```

Errors: `409 EMAIL_TAKEN`, `401 INVALID_CREDENTIALS`, `401 INVALID_REFRESH_TOKEN`, `401 UNKNOWN_USER`, `429 RATE_LIMITED`, validation errors.

#### Campus / map

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/campus` | — | `CampusOverview` |
| GET | `/api/campus/buildings` | — | `BuildingList` |
| GET | `/api/campus/buildings/:id/floors` | — | `BuildingFloors` |
| GET | `/api/campus/floors/:id` | `lang?` | `FloorPlan` |
| GET | `/api/campus/floors/:id/layers` | `types?, lang?` | `FloorLayers` |
| GET | `/api/campus/search-index` | — | `SearchIndex` |

```ts
Geometry = {
  type: 'Point' | 'LineString' | 'Polygon' | 'MultiPolygon' | 'MultiLineString'
  coordinates: unknown[]
}
Bounds = [minX: number, minY: number, maxX: number, maxY: number] // campus metres
Feature<P> = { type: 'Feature'; id: string; geometry: Geometry | null; properties: P }
Collection<F> = { type: 'FeatureCollection'; features: F[] }

CampusOverview = {
  campus: { id, name, nameAr, timezone }
  bounds: Bounds
  geofence: Geometry | null
  buildings: Building[]
  outdoor: {
    entrances: PoiCollection; ramps: PoiCollection; facilities: PoiCollection
    walls: WallCollection; passages: PassageCollection
  }
}
FloorPlan = {
  floor: { id, level, name, elevationM, building: BuildingRef }
  bounds: Bounds
  outline: Geometry | null
  layers: Layers
  at: string
}
LAYER_TYPES = rooms, walls, passages, entrances, elevators, stairs, ramps,
              toilets, accessible_toilets, facilities
```

Layer properties: rooms (`code`, `name`, `nameAr`, `type`, `capacity`, `wheelchairSpaces`, `hearingLoop`, `status`), POIs (`type`, `name`, `accessible`, `notes`, `level`, `navNodeId`), walls (`kind`, `label`), passages (`isOpen`, `closedReason`, `hasStairs`, `stepCount`, `isRamp`, `slopePercent`, `widthCm`, `doorClearanceCm`, `surface`, `verified`). `404` when campus/floor/building missing.

`SearchIndex` contains generated buildings/floors, rooms, POIs (with x/y), and upcoming club sessions; used by command palette and search.

#### Rooms

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/rooms` | filters below | `RoomList` |
| GET | `/api/rooms/:id` | `lang?` | `RoomDetail` |

Query params: `search` (1..80), `status` (comma list of `AVAILABLE|TEACHER|ADMIN|CLUB`), `buildingId`, `floor` (-5..50), `minCapacity` (1..2000), `stepFree` (stringbool), `limit` (1..200, default 100), `offset`, `lang`.

```ts
RoomStatus = {
  status: 'AVAILABLE' | 'TEACHER' | 'ADMIN' | 'CLUB'
  label: string
  occupantName: string | null
  title: string | null
  reservationId: string | null
  until: string | null
  freeAt: string
}
RoomSummary = {
  id, code, name, nameAr: string | null, type: RoomType, capacity,
  wheelchairSpaces, hearingLoop, building: BuildingRef,
  floor: { id, level, name }, x, y, stepFreeAccess: boolean, status: RoomStatus
}
RoomList = { items: RoomSummary[]; total: number; at: string }
RoomDetail = RoomSummary & {
  schedule: Reservation[]
  accessibility: {
    stepFreeAccess: boolean
    wheelchairAccessible: boolean
    doorClearanceCm: number | null
    wheelchairSpaces: number
    hearingLoop: boolean
  }
  nearest: { elevator: NearbyPoi | null; accessibleToilet: NearbyPoi | null }
}
```

Statuses use half-open intervals `[startsAt, endsAt)`; overlaps display with priority `ADMIN > TEACHER > CLUB`. `404 ROOM_NOT_FOUND`.

#### Reservations

| Method | Path | Auth / roles | Response |
|---|---|---|---|
| GET | `/api/reservations` | required | `ReservationList` |
| GET | `/api/reservations/:id` | required | `Reservation` |
| POST | `/api/reservations` | `TEACHER / ADMIN / CLUB` | `201 Reservation` |
| PATCH | `/api/reservations/:id` | owner/admin | `Reservation` |
| DELETE | `/api/reservations/:id` | owner/admin | `204` |

List query: `roomId?`, `from?`, `to?`, `kind?`, `mine?`; defaults start-of-day in `Africa/Algiers`, `to = from + 7 days`, max 31 days.

```ts
Reservation = {
  id, roomId, roomCode
  kind: 'TEACHER' | 'ADMIN' | 'CLUB'
  title, organizer, startsAt, endsAt
  ownerId: string | null   // null for imported timetable entries
}
ReservationList = { items: Reservation[]; from: string; to: string }
CreateReservation = {
  roomId: string
  kind?: 'TEACHER' | 'ADMIN' | 'CLUB'  // default TEACHER
  title: string            // 3..120
  organizer?: string       // 2..80; required for CLUB
  startsAt: string         // ISO-8601 with offset
  endsAt: string
}
UpdateReservation = Partial<Omit<CreateReservation, 'kind'>> // strict, ≥1
```

Rules: 15 min–12 h; future start; `400 INVALID_INTERVAL`; `409 RESERVATION_CONFLICT` with `details.conflicts`; `403 FORBIDDEN` for unauthorized kind/owner; `ADMIN` reservations only by `ADMIN`; `TEACHER` only by `TEACHER|ADMIN`. Mutations invalidate `['rooms']`, `['campus','floor']`, `['campus','overview']`.

#### Routing / navigate

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/routes/plan` | optional | `RoutePlan` |
| POST | `/api/routes/:id/recheck` | none | `RouteRecheck` |

```ts
RouteLocation =
  | { type: 'room'; id: string }     // id or code e.g. "B-212"
  | { type: 'poi'; id: string }
  | { type: 'node'; id: string }
  | { type: 'point'; x: number; y: number; level: number; floorId?: string }

RouteConstraintsInput = {
  useProfile?: boolean               // default true
  avoidStairs?: boolean
  maxSlopePercent?: number | null    // 0..30
  minDoorWidthCm?: number | null     // int 40..300
  verifiedRampsOnly?: boolean
  verifiedOnly?: boolean
  avoidEdgeIds?: string[]            // max 50
}
PlanRouteRequest = {
  from: RouteLocation
  to: RouteLocation
  constraints?: RouteConstraintsInput
  mode?: 'walking' | 'wheelchair'
  options?: Array<'fastest' | 'step-free'>  // 1..2, default both
  shorelineHints?: boolean
  lang?: Lang
}
RoutePlan = {
  routeId: string | null
  version: number
  engine: string
  from: ResolvedLocation
  to: ResolvedLocation
  travelMode: 'walking' | 'wheelchair'
  options: RouteOption[]
  unavailable: RouteUnavailable[]
}
RouteOption = {
  id: 'fastest' | 'step-free'; label; stepFree: boolean
  distanceM; etaSec; travelMode
  elevatorCount; rampCount; stairsCount
  levels: number[]
  constraints: EffectiveRouteConstraints
  prefilteredConstraints: string[]
  warnings: Array<{ code; message }>
  nodeIds: string[]; edgeIds: string[]
  steps: RouteStep[]
  geojson: RouteFloorGeoJson[]
}
RouteStep = {
  index
  type: 'START'|'WALK'|'RAMP'|'STEPS'|'ELEVATOR'|'STAIRS'|'ENTER'|'EXIT'|'ARRIVE'
  instruction; distanceM
  turn: 'STRAIGHT'|'SLIGHT_LEFT'|'LEFT'|'SHARP_LEFT'|'SLIGHT_RIGHT'
      | 'RIGHT'|'SHARP_RIGHT'|'U_TURN' | null
  fromNodeId; toNodeId; edgeIds; level; toLevel; floorId; x; y
  landmark: string | null
  shoreline: { side; feature; distanceM; offsetM; hint } | null
}
RecheckRouteRequest = {
  position: { x; y; level; floorId?; accuracyM? }
  option?: 'fastest' | 'step-free'
  lang?: Lang
}
RouteRecheck = {
  routeId; version; option
  status: 'ON_ROUTE' | 'ARRIVED' | 'REROUTED' | 'NO_ROUTE'
  reason: 'OFF_ROUTE' | 'EDGE_CLOSED' | 'WRONG_FLOOR' | null
  message; distanceFromRouteM: number | null
  progress: { completedM; remainingM; nextStepIndex } | null
  blockedEdge: { edgeId; description; closedReason } | null
  route: RouteOption | null
  unavailable: RouteUnavailable | null
}
```

Errors: `404 LOCATION_NOT_FOUND`, `422 LOCATION_NOT_ROUTABLE`, `422 LOCATION_OFF_GRAPH`, `404 ROUTE_NOT_FOUND`, `400 UNKNOWN_OPTION`, `500 ROUTING_ENGINE_ERROR`.

Client behavior: off-route threshold 8 m, arrival within 3 m; recheck ≥2 s apart, after ≥3 m movement or 8 s idle, immediately when off-route; watches `route:invalidated`.

#### Positioning / mobility

There is **no server positioning endpoint**. Position is client-only: `qr | manual | map | simulator | geolocation`, memory-only, with `accuracyM`, `floorId`, `source`, `label`, `at`. BLE/Wi-Fi is only a placeholder string.

All mobility endpoints require auth:

| Method | Path | Request / query | Response |
|---|---|---|---|
| GET | `/api/mobility/consent` | `lang?` | `MobilityConsent` |
| POST | `/api/mobility/consent` | `{ policyVersion, lang? }` | `MobilityConsent` |
| DELETE | `/api/mobility/consent` | `deleteData?, lang?` | `MobilityConsentRevoked` |
| DELETE | `/api/mobility/data` | — | `MobilityDataDeleted` |
| POST | `/api/mobility/sessions` | `{ needsCategory?, lang? }` | `201 MobilitySessionStatus` |
| GET | `/api/mobility/sessions/current` | `lang?` | `MobilitySessionStatus` |
| POST | `/api/mobility/sessions/:id/stop` | `lang?` | `MobilitySessionStatus` |
| POST | `/api/mobility/points` | `MobilityPointsBatch` | `MobilityIngestResult` |
| POST | `/api/mobility/events` | `MobilityEventReport` | `201 MobilityEventRecorded` |

```ts
MobilityConsent = {
  granted; upToDate; policyVersion; grantedAt; revokedAt
  currentPolicy: { version: string; summary: string[]; retentionDays: number }
}
MobilitySessionStatus = {
  state: 'NONE' | 'ACTIVE' | 'ENDED'
  message: string | null
  session: {
    id; needsCategory; startedAt; endedAt
    endReason: 'USER'|'GEOFENCE_EXIT'|'TIME_LIMIT'|'DAILY_RESET'|'CONSENT_WITHDRAWN'|null
    pointCount; lastPointAt; autoStopAt; autoStopReason
    remainingSec; reminder
  } | null
}
MobilityPointsBatch = {
  sessionId: string
  points: Array<{
    recordedAt: string; x; y; level; floorId?; accuracyM: number; routeId?: string
  }> // 1..100
  lang?: Lang
}
MobilityIngestResult = {
  accepted: number
  dropped: { lowAccuracy; outsideGeofence; jitter; outOfSession }
  session: MobilitySessionStatus
}
MobilityEventReport = {
  sessionId
  type: 'BLOCKED' | 'TOO_STEEP' | 'HARD_TO_NAVIGATE'
  note?: string       // max 280; contact details redacted
  x; y; level; floorId?; recordedAt?; routeId?
}
```

Privacy: `K_MIN=5`, max accuracy 10 m, 3 h session max, 15 min reminder, 30-day raw retention, 2 m cells, daily rotating pseudonym; no `userId` on movement tables. Errors: `403 CONSENT_REQUIRED`, `403 CONSENT_OUTDATED`, `409 POLICY_OUTDATED`, `404 SESSION_NOT_FOUND`, `409 SESSION_ENDED`, `422 OUTSIDE_GEOFENCE`.

#### Talk / speech

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/speech/status` | optional | — | `SpeechStatus` |
| POST | `/api/speech/tts` | required | `TtsRequest` | `200 audio/mpeg` |

```ts
SpeechStatus = {
  tts: {
    available: boolean
    provider: 'cartesia'
    model: string
    languages: Lang[]
    maxChars: number    // 600
  }
}
TtsRequest = { text: string /* 1..600 */; lang: Lang; speed?: number /* 0.6..1.5 */ }
```

TTS headers: `content-type: audio/mpeg`, `cache-control: private, max-age=86400`, `x-tts-cache: hit|miss`. Errors: `401`, `429 RATE_LIMITED`, `503 TTS_UNAVAILABLE`, `502 TTS_UPSTREAM_ERROR`. Server STT does not exist; Talk STT is browser Web Speech only (native module needed in Expo). `/api/ai` currently has no routes.

#### Admin

Most endpoints require `ADMIN`; floor SVG reads are optional-auth.

| Method | Path | Request | Response |
|---|---|---|---|
| PATCH | `/api/admin/edges/:id/status` | `{ isOpen, closedReason? }` | `EdgeStatus` |
| GET | `/api/admin/heatmap` | `period?, category?, level?` | `AdminHeatmap` |
| GET | `/api/admin/hotspots` | `level?, lang?` | `HotspotList` |
| GET | `/api/admin/corrections` | `status?, limit?` | `MapCorrectionList` |
| POST | `/api/admin/corrections/:id/approve` | `{ apply?, note? }` | `MapCorrectionReview` |
| POST | `/api/admin/corrections/:id/reject` | `{ note: string 3..500 }` | `MapCorrectionReview` |
| GET | `/api/admin/recommendations` | `status?, lang?` | `RecommendationList` |
| PATCH | `/api/admin/recommendations/:id` | `{ status, lang? }` | `Recommendation` |
| GET | `/api/admin/stats` | — | `MobilityStats` |
| GET | `/api/admin/floors/svgs` | — | `FloorSvgList` |
| GET | `/api/admin/floors/:id/svg` | — | `FloorSvg` |
| PUT | `/api/admin/floors/:id/svg` | `{ svgContent: string min 20 }` | `FloorSvg` |

```ts
AdminHeatmap = {
  period; category; windowStart; windowEnd; computedAt
  cellSizeM; kMin
  cells: Array<{ level; cellX; cellY; x; y; visits; contributors; difficulty; stuck }>
}
Hotspot = {
  id; level; floorId; x; y; radiusM; eventCount; contributorCount
  dominantType; byType; byCategory
  edge: { id; description; hasStairs; isRamp; slopePercent; widthCm; isOpen } | null
  shoreline: { wallId; wallKind; side; distanceM } | null
  computedAt
}
MapCorrection = {
  id; kind; source: 'CROWD'|'USER_REPORT'|'ADMIN'
  status: 'PENDING'|'ACCEPTED'|'REJECTED'
  title; description; edgeId; edgeDescription; level; x; y
  proposed; evidenceCount; createdAt; reviewedAt; reviewedBy; reviewNote
}
Recommendation = {
  id
  kind: 'RAMP'|'ELEVATOR'|'WIDEN_DOOR'|'ACCESSIBLE_ENTRANCE'|'SIGNAGE'
  status: 'OPEN'|'PLANNED'|'DONE'|'DISMISSED'
  title; rationale; score; evidence; level; x; y; edgeId; updatedAt
}
MobilityStats = {
  generatedAt; kMin; retentionDays
  sessions: { active; today; last7d }
  contributors: { today; last7d }
  categories7d: Array<{ category; sessions; contributors }>
  events7d: { reported; detected }
  rawData: { points; oldestPointAt }
  queue: { pendingCorrections; openRecommendations; hotspots }
  lastAggregationAt
}
FloorSvg = { floorId; buildingCode; buildingName; level; floorName; svgContent; isCustom; updatedAt }
```

Web client polls admin stats with `refetchInterval: 30_000`; it does not connect to the `/admin` socket.

#### Health / docs

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `Health`; `200` when DB up, `503` with `status:'degraded'` when down |
| GET | `/openapi.json` | OpenAPI 3.1 document |
| GET | `/docs` | Swagger UI |

```ts
Health = {
  status: 'ok' | 'degraded'
  service: 'accesu-server'
  uptimeS: number
  checks: { database: 'up' | 'down' }
  time: string
}
```

### 4.5 Realtime / Socket.io

Source: `server/src/sockets/*`, `client/src/realtime/*`.

**`/live` handshake:**

```ts
io('/live', {
  auth: { lang: i18n.language },
  transports: ['websocket', 'polling'],
})
```

Rooms: `floor:<floorId>:<lang>` and `route:<routeId>`; special floor id `outdoor`; max 12 floors per socket.

Client → server:

| Event | Payload | Ack |
|---|---|---|
| `floor:join` | `{ floorId }` | `{ ok:true, statuses: RoomStatusEvent[] }` or `{ ok:false, error }` |
| `floor:leave` | `{ floorId }` | `{ ok }` |
| `route:watch` | `{ routeId: UUID }` | `{ ok }` / `INVALID_PAYLOAD` |
| `route:unwatch` | `{ routeId: UUID }` | `{ ok }` |

Server → client:

```ts
RoomStatusEvent = { roomId; code; floorId; status: RoomStatus; at }
EdgeStatusEvent = { edgeId; floorId; isOpen; closedReason; at }
RouteInvalidatedEvent = {
  routeId; option; reason: 'EDGE_CLOSED'|'OFF_ROUTE'|'WRONG_FLOOR'
  edgeId; version; rerouted; at
}
```

Cache behavior: `SocketProvider` keeps one socket per language; `useLiveFloors()` joins/leaves displayed floors; `room:status` patches FloorPlan/RoomList/RoomDetail caches; `edge:status` invalidates floor plans and campus overview; `route:invalidated` forces a recheck.

**`/admin` handshake:** `io('/admin', { auth: { token: '<ADMIN access token>' } })`; non-admin rejected with `FORBIDDEN`. Server → client events: `stats` (`MobilityStats`), `mobility:aggregated`, `correction:updated`, `recommendation:updated`. Stats throttled to 10 s.

Domain bus events (`server/src/lib/events.ts`): `rooms.changed`, `edge.changed`, `graph.changed`, `mobility.sessionStarted`, `mobility.sessionEnded`, `mobility.aggregated`, `admin.correction`, `admin.recommendation`, `route.invalidated`. Background jobs: room status ticker each minute at second 1; mobility detectors each minute at :05; aggregation every 5 min at :20; retention purge hourly at :40 and 5 s after boot.

### 4.6 State management

**TanStack Query** (`client/src/App.tsx`): `retry: 1`, `refetchOnWindowFocus: false`.

| Hook | Query key | Freshness / interval |
|---|---|---|
| `useBuildings` | `['campus','buildings']` | 10 min |
| `useCampusOverview` | `['campus','overview']` | 5 min |
| `useFloorPlan` | `['campus','floor',floorId,lang]` | 60 s |
| `useSearchIndex` | `['campus','search-index']` | 5 min |
| `useRooms` | `['rooms','list',params,lang]` | 30 s + poll 60 s |
| `useRoom` | `['rooms','detail',idOrCode,lang]` | 30 s |
| `useRoomSearch` | `['rooms','search',q]` | 30 s, enabled when `q.length >= 2` |
| `useSpeechStatus` | `['speech','status']` | 10 min, `retry:false` |
| `useConsent` | `['mobility','consent',lang]` | 5 min |
| `useSharingStatus` | `['mobility','session',lang]` | poll 60 s while ACTIVE |
| `useAdminStats` | `['admin','stats']` | poll 30 s |
| `useAdminHotspots` | `['admin','hotspots',level]` | default |
| `useAdminRecommendations` | `['admin','recommendations']` | default |
| `useFloorSvgList` / `useFloorSvg` | `['admin','floors',…]` | default |
| `useMe` | `['me']` | set on login/profile save |

Mutations: login, logout (clear store + `qc.clear()`), save profile, create/cancel reservation, admin recommendation update, floor SVG save, route plan, mobility consent/start/stop.

**Zustand stores:**

| Store | File | Persistence | Shape / notes |
|---|---|---|---|
| `useAuth` | `client/src/stores/auth.ts` | none | `status`, `accessToken`, `user`, `setSession`, `setUser`, `clear`; token memory-only |
| `usePreferences` | `client/src/stores/preferences.ts` | `campusway.preferences` v1 | theme, motion, textScale, lang, sidebarCollapsed, floorId |
| `useMapPrefs` | `client/src/stores/mapPrefs.ts` | `campusway.map` v1 | layer visibility for classrooms, entrances, elevators, stairs, ramps, toilets, accessible_toilets, facilities, status, closed |
| `useSaved` | `client/src/stores/mapPrefs.ts` | `campusway.saved` v1 | saved room codes, `toggleRoom(code)` |
| `usePosition` | `client/src/features/navigate/position.ts` | none | current position or `null` |
| `useNav` | `client/src/features/navigate/navStore.ts` | none | navigation phase, request, plan, option, track, routeId, stepIndex, message, paused, voice, sim, pending |

Expo: keep Zustand + TanStack Query; replace persistence adapter with AsyncStorage/MMKV and SecureStore for auth; keep the same query keys so cache-invalidation logic ports directly.

### 4.7 Shared models & validation schemas

The server is the source of truth: Zod schemas in `server/src/modules/*/*.schemas.ts` and `server/src/openapi/schemas.ts` generate `client/src/api/openapi.json` → `client/src/api/schema.d.ts` → re-exported by `client/src/api/types.ts`. **Do not hand-write API shapes** in the RN app; mirror the generation step or copy the generated types.

Key enums/unions: `Role`, `Locale`, `Lang`, `MobilityProfile`, `RoomType`, `RoomStatusCode`, `ReservationKind`, `PoiType`, `NavNodeKind`, `Surface`, `WallSide`, `WallKind`, `SessionEndReason`, `DifficultyType`, `CorrectionKind/Source/Status`, `RecommendationKind/Status`, `RouteLocation` variants, `RouteOptionId`, `RouteStepType`, `RouteTurn`.

Important exported types include `Me`, `AccessibilityProfile`, `UpdateAccessibilityProfile`, `AuthSession`, `RoomSummary`, `RoomList`, `RoomDetail`, `RoomStatus`, `Reservation`, `Building`, `BuildingList`, `ApiError`, `NearbyPoi`, `FloorPlan`, `CampusOverview`, `SearchIndex`, room/POI/wall/passage features, `Geometry`, route types, mobility types, and `SpeechStatus`.

### 4.8 Error handling conventions

Single response shape:

```ts
{
  error: {
    code: string
    message: string
    details?: unknown
  }
}
```

- `HttpError` → its status/code/details.
- `ZodError` → `400 VALIDATION_ERROR`, `details: [{ path, message }]`.
- `validate()` → `400 VALIDATION_ERROR`, `details: [{ location:'params'|'query'|'body', path, message }]`.
- Unknown → `500 INTERNAL_ERROR`, no stack traces.

Known codes include `UNAUTHORIZED`, `INVALID_TOKEN`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `INVALID_REFRESH_TOKEN`, `UNKNOWN_USER`, `RESERVATION_CONFLICT`, `INVALID_INTERVAL`, `ROOM_NOT_FOUND`, `RESERVATION_ENDED`, `POLICY_OUTDATED`, `CONSENT_REQUIRED`, `CONSENT_OUTDATED`, `SESSION_ENDED`, `SESSION_NOT_FOUND`, `OUTSIDE_GEOFENCE`, `ROUTE_NOT_FOUND`, `UNKNOWN_OPTION`, `LOCATION_NOT_FOUND`, `LOCATION_NOT_ROUTABLE`, `LOCATION_OFF_GRAPH`, `ROUTING_ENGINE_ERROR`, `TTS_UNAVAILABLE`, `TTS_UPSTREAM_ERROR`, `ALREADY_REVIEWED`, `INVALID_PROPOSAL`, `NO_EDGE`, `MAP_SCHEMA_UNINITIALIZED`.

### 4.9 Database / PostGIS model

`server/prisma/schema.prisma`: PostgreSQL 16 + PostGIS + `btree_gist`; SRID 0, planar metres; campus `x → east`, `y → north`, origin south-west.

Model groups: People (`User`, `AccessibilityProfile`), Campus (`Campus`, `Building`, `Floor`, `Room`, `Poi`), Schedule (`Reservation` with DB `EXCLUDE` preventing overlaps), Navigation graph (`NavNode`, `NavEdge`, `Wall`), Mobility (`TrackingSession`, `TrackPoint`, `DifficultyEvent`, `MobilityConsent`, `PseudonymSalt`), Analytics (`MapCorrection`, `HeatmapCell`, `Hotspot`, `Recommendation`).

### 4.10 API-layer acceptance criteria

1. `EXPO_PUBLIC_API_URL` used consistently for axios and Socket.io; no reliance on Vite proxy.
2. Refresh token stored in SecureStore; 401 refresh-and-retry preserved.
3. All query keys and cache invalidation patterns match the web client.
4. Zod/OpenAPI-generated types reused rather than duplicated by hand.
5. Socket rooms (`floor:<id>:<lang>`, `route:<id>`) and reconnection behavior preserved.
6. Error codes mapped to localized user messages.
7. Mobility consent, policy version, and data deletion flows implemented before any tracking.

---

## 5. Mobile-Specific Requirements

The web client is Vite + React 18 + react-router-dom v6 + Leaflet + Socket.io + Zustand + TanStack Query. It has no native code and no PWA/service worker. Every browser-only capability below needs an Expo equivalent.

### 5.1 Device API / feature replacement matrix

| Web feature & source | Current implementation | Expo / React Native requirement |
|---|---|---|
| GPS position — `client/src/features/navigate/position.ts:158-175`, `PositionPanel.tsx` | `navigator.geolocation.watchPosition()` with high accuracy; `geolocationStatus()` feature check | `expo-location`: `requestForegroundPermissionsAsync()` → `watchPositionAsync({ accuracy: Accuracy.High, maximumAge: 2000, timeout: 15000 })`, `subscription.remove()`. Add iOS `NSLocationWhenInUseUsageDescription` and Android `ACCESS_FINE_LOCATION`. Handle denied/undetermined with `Linking.openSettings()`. |
| Campus coordinate conversion — `position.ts:141-154` | `VITE_CAMPUS_GEOREF` + equirectangular math | Pure logic unchanged; replace env with `EXPO_PUBLIC_CAMPUS_GEOREF`. |
| Indoor position simulator — `position.ts:74-133`, `useNavigationController.ts:259-280` | `Simulator` class driven by `window.setInterval` @500ms | Keep pure simulator; use plain `setInterval` with cleanup and `AppState` pause when backgrounded. |
| QR checkpoints — `position.ts:51-70`, `checkpoints.ts`, `NavigatePage.tsx:100-120` | Parse `https://…?at=`, `room:`, `poi:`, room codes; deep links via `?at=` | Reuse parsing. Use `expo-linking` universal links / custom scheme; register intent filters and associated domains. |
| Camera QR scanning — `QrCheckpointDialog.tsx:18-21,50-132` | `window.BarcodeDetector` + `getUserMedia({video:{facingMode:'environment'}})` + polling `detect()` | `expo-camera` `CameraView` with QR `barcodeScannerSettings` and `onBarcodeScanned` (or `react-native-vision-camera`). Keep manual code entry fallback. Add camera permission. |
| SVG upload — `AdminPage.tsx:713-787,827-829` | `<input type="file">`, drag/drop, `File.text()` | `expo-document-picker` + `expo-file-system.readAsStringAsync()`. Replace drag/drop with a Choose File button. |
| SVG/blob download — `AdminPage.tsx:752-763`, `IsometricCampusMap.tsx:478-488` | `Blob`, `URL.createObjectURL`, anchor `.download` click | `expo-file-system.writeAsStringAsync()` to cache directory + `expo-sharing.shareAsync()`. |
| Remote building photos — `IsometricCampusMap.tsx:66-142,534-537` | Unsplash `<img>` URLs | `expo-image` with `source={{ uri }}`; prefer bundled assets for offline use. |
| In-app toasts — `components/ui/Toast.tsx` | Fixed CSS toast, `aria-live`, 6s timer, hover/focus pause | Rebuild with absolutely positioned `View` + `Animated`; keep `useToast()` API; call `AccessibilityInfo.announceForAccessibility()` for assertive messages. |
| Screen-reader announcements — `a11y/Announcer.tsx`, `Toast.tsx`, `TalkPage.tsx:412`, `PositionPanel.tsx:75` | Persistent `aria-live` divs | `accessibilityLiveRegion="polite"/"assertive"` + `AccessibilityInfo.announceForAccessibility()`. Keep one provider abstraction. |
| Push notifications | **Not used** on web (`new Notification`, service worker absent) | No migration required. Add `expo-notifications` only as a new feature. |
| Server TTS playback — `features/navigate/speech.ts:78-105`, `TalkPage.tsx:243-301` | `axios` blob → `URL.createObjectURL` → `new Audio(url)`; LRU object URL cache | `expo-file-system.downloadAsync()` → local `file://` URI → `expo-av` `Audio.Sound.createAsync()` / `setOnPlaybackStatusUpdate()` / `unloadAsync()`. |
| Device TTS fallback — `speech.ts:107-119`, `VOICE_LANG` at `:10` | `speechSynthesis` with `ar-DZ` / `fr-FR` / `en-GB` | `expo-speech.speak(text, { language, rate, voice })`, `cancel()`, `getAvailableVoicesAsync()`. |
| Speech recognition — `TalkPage.tsx:30-72,146-241` | Web Speech API `SpeechRecognition`/`webkitSpeechRecognition`, locales `ar-DZ`/`fr-FR`/`en-US` | No first-party Expo SDK module. Use `@react-native-voice/voice` or an Expo dev-client plugin such as `expo-speech-recognition`; add microphone permission and privacy description. |
| Vibration cues — `speech.ts:122-130`, `useNavigationController.ts:125,143,162` | `navigator.vibrate(pattern)` | `expo-vibration` or `Vibration.vibrate()`; iOS ignores patterns. |
| Audio guidance controls — `AudioNavigation.tsx:73-176` | Keyboard shortcuts Space/W/P/Enter + `scrollIntoView` | Keep on-screen big buttons as primary; add `exposeAccessibilityActions`/`onAccessibilityAction` for switch access; use refs + `AccessibilityInfo` instead of `scrollIntoView`. |
| Realtime — `realtime/SocketProvider.tsx:7,20-33`, `liveRooms.ts:36-59`, `useNavigationController.ts:236-255` | `socket.io-client` to relative `/live` via Vite proxy; `floor:join`, `room:status`, `edge:status`, `route:watch`, `route:invalidated` | `socket.io-client` works in RN. Use absolute `EXPO_PUBLIC_API_URL/live`; prefer `transports:['websocket']`; add `AppState` reconnect/rejoin and offline guards. |
| Preferences persistence — `stores/preferences.ts:34-65` | Zustand `persist` over `localStorage`, key `campusway.preferences` | `createJSONStorage(() => AsyncStorage)` or MMKV. Store theme, motion, textScale, lang, sidebar/floor state. |
| Map/saved rooms — `stores/mapPrefs.ts:15-52` | `campusway.map`, `campusway.saved` in `localStorage` | Same AsyncStorage/MMKV adapter. |
| Auth session — `stores/auth.ts`, `api/client.ts:11-52`, `App.tsx:59-65` | Access token in memory; refresh token in httpOnly cookie; axios `withCredentials`; 401 interceptor replays request | **Critical:** cookies/httpOnly are not automatic in RN. Store refresh token in `expo-secure-store`, send explicitly (Bearer header or server-approved Cookie header), keep access token in memory, preserve the 401 refresh-and-retry flow. |
| Connectivity — `api/client.ts:54-61` | `!err.response → NETWORK` error code | Keep error mapping; add `expo-network` / NetInfo offline banner. |
| Background position upload — `sharing.ts:94-172` | `setInterval` flush every 10s | Foreground: keep interval with cleanup. True background: `expo-location` background mode + `expo-task-manager` + queued storage; Android foreground service may be required. |
| Floor plans / route map — `FloorMap.tsx`, `RouteMap.tsx`, `MapPage.tsx` | Leaflet `CRS.Simple`, `L.svg()`, `L.divIcon`, polyline, pan/zoom | No Leaflet in RN. Use `react-native-svg` + `react-native-gesture-handler` (pinch/pan) + `react-native-reanimated`, reusing pure geometry from `features/map/geometry.ts`, `spatialNav.ts`, `icons.tsx`. Do not use `react-native-maps` for `CRS.Simple` floor plans. |
| Isometric campus — `IsometricCampusMap.tsx:757-1092` | Large inline SVG with procedural geometry, gradients, filters | `react-native-svg` or pre-rendered PNG/WebP with interactive overlay paths. |
| Raw server SVG | `dangerouslySetInnerHTML` in `IsometricCampusMap.tsx:688,1275`, `AdminPage.tsx:955` | WebView fallback, sanitizer + SVG element tree, or server rasterization. |
| Copy / share — `TalkPage.tsx:303-306`, `IsometricCampusMap.tsx:606-626` | `navigator.clipboard.writeText`, button labelled Share but copies URL | `expo-clipboard`; `expo-sharing.shareAsync()` for real sharing; build deep link with `expo-linking.createURL()`. |
| Drag gestures — `ui/BottomSheet.tsx:55-77` | Pointer capture + `window.innerHeight` | `react-native-gesture-handler` pan + `react-native-reanimated` sheet (`@gorhom/bottom-sheet` or similar); use `useWindowDimensions()`. |
| Global shortcuts — `AppShell.tsx:256-267` | Ctrl/⌘+K, `/` via document keydown | No touch equivalent; keep visible search button. Add hardware-keyboard handling for tablets via `react-native-keyboard-controller` if desired. |
| Focus trap / inert — `a11y/focus.ts`, `Dialog.tsx`, `BottomSheet.tsx`, `SidePanel.tsx` | `querySelectorAll`, `document.activeElement`, `inert`, `aria-hidden`, portals | RN `Modal`, ref focus, `AccessibilityInfo.setAccessibilityFocus`, `importantForAccessibility="no-hide-descendants"`, `accessibilityViewIsModal`; no `document`. |
| Responsive tiers — `lib/hooks.ts:4-38`, `AppShell.tsx` | `window.innerWidth / textScale`, `matchMedia` | `useWindowDimensions()`, `Appearance.addChangeListener`, `AccessibilityInfo.isReduceMotionEnabled()` / `reduceMotionChanged`, `I18nManager` for RTL. |
| Browser globals | `window.setTimeout/setInterval`, `document.*`, `navigator.*`, `URL.createObjectURL`, portals | Replace with RN timers, refs, `expo-*` modules, `expo-linking`, `expo-file-system`, RN `Modal`. |
| Compile-time env | `VITE_CAMPUS_GEOREF`, `VITE_LOG_SIMULATED_POSITIONS`, `__DEMO_PASSWORD__` from `vite.config.ts` | `EXPO_PUBLIC_*` env vars and `expo-constants` / `app.json.extra`. |
| DOM mount / router / query strings | `main.tsx`, `App.tsx`, `useSearchParams` across pages | `registerRootComponent(App)`; React Navigation + `expo-linking`; route params instead of query-string hooks. |

### 5.2 Permissions and app configuration

Declare in `app.json` / native projects:

- Location: `NSLocationWhenInUseUsageDescription`, Android `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`.
- Camera (QR): `NSCameraUsageDescription`, Android `CAMERA`.
- Microphone (speech recognition): `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`.
- Notifications only if adding push: `expo-notifications` plugin, Android channel, iOS entitlements.
- Background location only if implementing background sharing: `expo-location` background mode + `expo-task-manager`; Android foreground service.
- Orientation/layout: support portrait and landscape tablets if reproducing split-view right panel.
- Deep links: universal links / app links for `/navigate?at=…`, `/map?room=…`, `/rooms?code=…`.

### 5.3 Recommended Expo dependency set

```text
expo-location, expo-camera (or react-native-vision-camera),
expo-av, expo-speech, expo-vibration, expo-clipboard, expo-sharing,
expo-document-picker, expo-file-system, expo-secure-store,
@react-native-async-storage/async-storage (or react-native-mmkv),
expo-linking, expo-localization, expo-network (or @react-native-community/netinfo),
expo-font, expo-image, expo-keep-awake,
expo-notifications (optional push), expo-background-fetch + expo-task-manager (optional background sharing),
@react-navigation/native + native-stack + bottom-tabs,
react-native-svg, react-native-gesture-handler, react-native-reanimated,
@gorhom/bottom-sheet (or equivalent), lucide-react-native,
@react-native-voice/voice (or expo-speech-recognition plugin),
react-native-keyboard-controller (tablet keyboard shortcuts),
react-native-webview (fallback for raw SVG preview)
```

### 5.4 Highest-risk migration items

1. **Leaflet `CRS.Simple` floor plans and isometric SVG** — no direct native equivalent; requires custom SVG/gesture renderer or WebView/pre-render approach.
2. **Cookie-based auth refresh** — must be redesigned for SecureStore + explicit token header while preserving the 401 retry contract.
3. **Web Speech Recognition** — no first-party Expo SDK module; requires a native module or cloud STT.
4. **Raw server SVG injection** — RN has no `dangerouslySetInnerHTML`; requires WebView, sanitized SVG tree, or rasterization.
5. **Background position upload** — requires background permissions, task manager, queueing, and platform-specific foreground service behavior.

### 5.5 Explicitly absent — no porting work required

Confirmed absent in the web client: Web Notifications API, service worker/PWA, `navigator.share`, Fullscreen API, screen wake lock, `AudioContext`, `MediaRecorder`, HTML `<canvas>`/2D/WebGL context, `sessionStorage`, IndexedDB, Bluetooth/NFC/Wi-Fi APIs, device orientation, IntersectionObserver. Bluetooth/Wi-Fi appear only as explanatory i18n strings for future indoor positioning.

### 5.6 Native acceptance criteria

1. All device permissions requested contextually with clear rationale and graceful denial handling.
2. QR scanning works with camera permission and manual-code fallback.
3. Login/session survives app restart using SecureStore; 401 refresh-and-retry works offline/online transitions.
4. Route guidance speaks instructions, vibrates cues, announces accessibility messages, and keeps screen awake if enabled.
5. Floor plans and isometric campus remain pannable/zoomable and fully usable by touch.
6. Theme, text scale, reduced motion, and RTL work with RN APIs and persist across restarts.
7. Deep links restore map/rooms/navigate state including `?at=` checkpoints.
8. No browser-only globals remain in shared business logic.

---
