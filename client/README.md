# accesU — client

React 18 + Vite + TypeScript (strict) + Tailwind 3, built to WCAG 2.2 AA. The visual language is in [DESIGN_REFERENCE.md](DESIGN_REFERENCE.md).

```bash
cp .env.example .env    # API_PROXY_TARGET, default http://localhost:4000
npm install
npm run dev             # http://localhost:5173 (proxies /api, /health, /socket.io)
npm test                # Vitest + Testing Library + axe-core (162 tests)
npm run lint            # ESLint with jsx-a11y (strict)
npm run build           # type-check + production build
npm run api:sync        # re-export the server OpenAPI and regenerate src/api/schema.d.ts
```

## Structure

```
src/
  styles/tokens.css       design tokens as CSS variables (light / dark / hc), type scale, motion
  styles/contrast.test.ts WCAG contrast of every token pair in every theme, read from tokens.css
  stores/preferences.ts   theme, text scale (100–200 %), motion, language → <html data-theme data-motion lang dir style="font-size">
  stores/auth.ts          session (access token in memory only)
  i18n/                   AR / FR / EN (en.ts is the typed source; missing keys fail the build)
  api/                    axios client (JWT + single-flight refresh), TanStack Query hooks, types generated from /openapi.json
  realtime/               Socket.io provider for /live
  a11y/                   focus trap, inert background, live-region announcer
  components/ui/          Button, IconButton, Input, Select, Chip, Toggle, Tabs, RadioGroup, RangeField, StatusBadge,
                          Card, IconTile, Badge, BottomSheet, SidePanel, Dialog, Toast, Skeleton, EmptyState
  components/shell/       AppShell (sidebar / rail + drawer / bottom tabs), top bar, Ctrl+K palette, right panel, Page
  features/profile/       needs ↔ accessibility profile model
  pages/                  Landing, Login, Onboarding / Profile, Settings, Design system, More, placeholders
```

## Accessibility foundation

- **Themes**: light, dark and high contrast (black / white / yellow), switchable at runtime, with "Automatic" following `prefers-color-scheme` and `prefers-contrast`.
- **Text size**: 100–200 % sets the root font size, and every size is in rem. The **layout tier uses the effective width** (viewport ÷ text scale), so 200 % text reflows to the tablet or phone layout, like browser zoom.
- **RTL**: `dir` is set on `<html>`, and only logical utilities are used (`ms-`, `pe-`, `start-`, `border-s`…). Direction-dependent icons flip, and arrow keys in tabs are mirrored. Numbers and units go through `Intl` (ar-DZ, Latin digits).
- **Navigation**:
  - A skip link and landmarks (`banner`, labelled `nav`s, `main#main`, `aside`).
  - On every navigation the page `<h1>` takes focus and the new page is announced in a polite live region, and `document.title` is updated.
- **Controls**: 48 px minimum targets, a visible 3 px focus ring (4 px yellow in high contrast), and reduced motion from the system or the in-app setting.
- **Status**: never colour alone. Badges always combine icon + label + pattern (solid, stripes or dots).
- **Lint and tests**: ESLint `jsx-a11y` strict, axe-core audits of every component and page in the tests, and a contrast test of the tokens.

## Map and rooms (step 6)

- **Plan**: [features/map/FloorMap.tsx](src/features/map/FloorMap.tsx) uses Leaflet with `CRS.Simple` (1 unit = 1 m; GeoJSON `[x, y]` from the API maps directly). There are floor scopes and a campus scope (outdoor paths, entrances, parking).
  - Rooms show status as fill colour + SVG pattern, plus a label with a pattern swatch and an icon.
  - Places use 36 × 44 pins. Accessible features get a different tone **and** a wheelchair badge.
  - Closed passages show as a red dotted line.
- **Keyboard**: every room, place and building is a real button with a full accessible name ("A-104, Salle de TD A-104. Occupied — teacher · until 15:30"), in reading order (mirrored in RTL).
  - Arrow keys jump to the nearest item in that screen direction; Enter or Space opens it.
  - The Map/List switch gives the same information as lists, with ↑/↓ roving focus.
- **Live updates**: [realtime/liveRooms.ts](src/realtime/liveRooms.ts) joins the displayed floors on `/live` and patches the query cache on `room:status`. The map restyles the room in place (focus kept, short flash unless motion is reduced), and changes to the selected room are announced.
- **Layers**: a popover on desktop and a bottom sheet on phones, remembered per device.
- **Find a room** ([features/rooms/RoomsPage.tsx](src/features/rooms/RoomsPage.tsx)):
  - Filters, sort, view and page live in the URL, so a search can be shared.
  - Desktop shows a table (sortable headers with `aria-sort`) or cards; phones show cards, with filters in a bottom sheet.
  - The Free column reads "Free until 14:00" or "Free at 16:00", in campus time.
- **Room detail** in the shell panel: status, today's timeline, accessibility, nearest step-free elevator and toilet, nearby rooms, Get directions, and Save (kept on the device).
- **Search** (Ctrl K): rooms, buildings, places and clubs from `/api/campus/search-index`. Fuzzy matching in AR/FR/EN ([lib/search.ts](src/lib/search.ts)) ignores accents and Arabic letter variants and the article ("مكتبة" finds "المكتبة"), handles codes without separators ("a104"), and tolerates typos.
- **Deep links**: `/map?room=A-104`, `/map?poi=<id>`, `/map?building=B`, `/map?view=campus`, `/map?mode=list`.
- **Tests**: [features/map/step6.test.tsx](src/features/map/step6.test.tsx) runs on real API payloads in [src/test/fixtures](src/test/fixtures) (captured from the seeded server).

## Navigation (step 7)

Code: [features/navigate/](src/features/navigate/).

- **Planner** ([RoutePlanner.tsx](src/features/navigate/RoutePlanner.tsx)):
  - **From**: my location, a QR checkpoint, a point picked on the plan, or a search (an ARIA combobox with AR/FR/EN fuzzy matching). **To** works the same way.
  - **Route needs** are chips pre-filled from the accessibility profile; changes apply to that trip only.
  - Option cards compare **Fastest** and **Step-free**: time, distance, and elevator / stairs / ramp counts.
  - When no route fits, a card explains what blocks it and where, with **Allow …** buttons to relax a need.
- **Position** ([position.ts](src/features/navigate/position.ts)): one store, several providers, always shown with its accuracy.
  - **QR checkpoint**: the camera scans through `BarcodeDetector` where the browser supports it. Typing the code or the room code always works. A printed QR can also be a link, `/navigate?at=poi:<id>`.
  - **"I'm here"**: ±5 m. **Picked on the plan**: ±3 m, by click or keyboard (crosshair + Enter).
  - **Demo simulator**: 1.2 m/s (1 m/s in a wheelchair), ×1/×2/×4, fixed time for elevator and stair rides, and a "wrong turn" button.
  - **Satellite placeholder**: outdoors only, used when `VITE_CAMPUS_GEOREF` is set. The slot for BLE / Wi-Fi indoor positioning.
- **Visual guidance** ([NavigationView.tsx](src/features/navigate/NavigationView.tsx)):
  - An instruction bar shows the current step, the metres left on it, what comes next, the time and distance left, and Stop.
  - The route uses the route colour on a casing. The walked part is muted, and a proposed reroute is dashed.
  - The map switches floor automatically at elevators and stairs.
  - The step list (a side column on desktop) uses `aria-current="step"` and has a progress bar.
  - "Report a problem here" opens a dialog.
- **Audio guidance** ([AudioNavigation.tsx](src/features/navigate/AudioNavigation.tsx)) is a forced high-contrast screen with huge text and three big buttons:
  - **Repeat** (Space), **Where am I?** (W): floor, nearest place, current step, next decision, the wall to follow, accuracy. **Pause** (P). Enter accepts a reroute.
  - Every message is mirrored in live regions.
  - The voice comes from the server (Cartesia), falling back to the device (`speechSynthesis`); it can be turned off for screen-reader users.
  - Cues come about 12 m before each decision point and again at it. Turns vibrate: 1 long buzz = left, 2 short = right, 3 = floor change or arrival.
- **Live rerouting** ([useNavigationController.ts](src/features/navigate/useNavigationController.ts)):
  - `/routes/:id/recheck` runs on movement: at least every 3 m or 8 s, never more than once every 2 s, and immediately when more than 8 m off the route.
  - The client watches `route:invalidated` on `/live`.
  - A closed passage gives a spoken alert, for example "Escalier Bloc A is closed — rerouting via the elevator.", with **Follow the new route**. Leaving the route reroutes on its own.
  - An expired route is planned again from the current position. Then comes the arrival screen.
- **Sharing** ([features/sharing/](src/features/sharing/)):
  - A consent dialog shows the server's policy summary.
  - While sharing is on, real positions (never simulated ones) are batched every 10 s and tagged with `routeId`.
  - Reports go through the active session, or through a one-off session opened and closed for the report.
- **Tests**: [navigate.unit.test.ts](src/features/navigate/navigate.unit.test.ts) (track, cues, wording, providers, logger, voice fallback) and [navigate.test.tsx](src/features/navigate/navigate.test.tsx) (planner, guidance, rerouting, audio, report, with axe checks).
  - They run on payloads captured from the API (`planA104*.json`, `planNoRoute.json`, `recheckRerouted.json`).

## Layout

| Effective width | Shell |
|---|---|
| ≥ 1200 px | 240 px sidebar (collapsible to 72 px) · top bar (Ctrl K search, floor, language, theme, profile) · optional 400 px right panel |
| 768–1199 px | 72 px icon rail + navigation drawer · the right panel becomes an overlay drawer |
| < 768 px | Bottom tab bar (Map, Rooms, Navigate, Talk, More) · the right panel becomes a bottom sheet (25 / 55 / 92 % snap points) |

## API

`src/api/schema.d.ts` is generated by `openapi-typescript` from `src/api/openapi.json`, which the server exports. Use the re-exports in [src/api/types.ts](src/api/types.ts) and never hand-write API types.

The refresh token is an httpOnly cookie; the app restores the session on load through `/api/auth/refresh`.
