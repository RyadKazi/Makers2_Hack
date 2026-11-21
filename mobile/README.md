# AccesU Student Mobile App

AccesU Mobile is a React Native application for students to explore campus map data, request routes using their saved accessibility preferences, manage those preferences, report navigation difficulties, and use communication prototypes. The app is a separate Expo project in `mobile/`; the existing Express backend remains the source of truth for accounts, campus data, routing, and mobility consent.

## Current implementation

- Expo SDK 58, Expo Router, TypeScript, React Native, TanStack Query.
- Login, registration, persistent bearer token storage with Expo SecureStore, cookie-based refresh attempts, profile and accessibility settings.
- Campus/building/floor layers and destination search from the backend; route requests use the backend route planner and render returned floor geometry, nodes, steps, warnings, and route alternatives.
- Speech-to-text and text-to-speech are explicitly simulated prototypes. They do not record, recognize, synthesize, or send audio.
- Mobility sharing requires the backend's consent policy and an explicit start action. This app does not collect background location or upload position samples. A persistent in-app banner exposes an active session and stop action.
- Difficulty reports use the backend mobility event endpoint and therefore require an active voluntary session and a selected campus map point. Reports are not shown as verified.
- Local recent destinations and favourites are stored on the device.
- Notification screen is an honest unavailable state because the backend currently has no student notification endpoint.

The backend routing engine currently labels itself a temporary stand-in Dijkstra implementation. The app displays only routes returned by that service and makes no claim that the route engine is production-ready.

## Requirements and setup

- Node.js 20 or newer (matching the backend).
- npm.
- Expo Go or an Android/iOS simulator for interactive device testing.
- The AccesU Express backend running on a reachable network address.

```powershell
cd mobile
npm install
Copy-Item .env.example .env
```

Edit `.env` and set `EXPO_PUBLIC_API_BASE_URL` to the backend API root. The backend in this repository defaults to `http://localhost:4000`, with API routes under `/api`:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.25:4000/api
```

Use `http://127.0.0.1:4000/api` for a local simulator that shares the host network. For a physical phone, use the development computer's LAN IP and ensure both devices are on a network that permits connections. Do not put private service keys in `EXPO_PUBLIC_*` variables; the mobile app never needs the AI service key.

## Run the app

```bash
npm start
```

Scan the Expo QR code with Expo Go. Or run `npm run android` / `npm run ios` when the corresponding simulator and native toolchain are installed. For a physical device, configure the LAN URL above. The backend's exact allowed-origin policy applies to web clients; native requests do not use browser CORS, but still need a reachable backend URL.

## API integration

All requests go through `src/api/client.ts`, which adds locale and bearer headers, parses the backend's `{ error: { code, message } }` errors, stores access tokens using SecureStore, and attempts a refresh on authenticated 401 responses. Request types and API response types are in `src/types/api.ts`.

| App feature | Backend endpoints used |
| --- | --- |
| Auth | `POST /api/auth/login`, `/register`, `/refresh`, `/logout`; `GET /api/me`; `PUT /api/me` |
| Student settings | `GET/PUT /api/me/accessibility-profile` |
| Campus map | `GET /api/campus/`, `/campus/buildings`, `/campus/floors/:id`, `/campus/search-index` |
| Navigation | `POST /api/routes/plan` |
| Sharing | `GET/POST/DELETE /api/mobility/consent`; `GET /api/mobility/sessions/current`; `POST /api/mobility/sessions`; `POST /api/mobility/sessions/:id/stop`; `DELETE /api/mobility/data` |
| Difficulty report | `POST /api/mobility/events` |

Example route call (the app's `navigationApi` adds `auth: true` and the current locale):

```ts
const plan = await navigationApi.plan({
  from: { type: 'room', id: 'ROOM_ID_FROM_SEARCH_INDEX' },
  to: { type: 'room', id: 'DESTINATION_ROOM_ID' },
  mode: 'wheelchair',
  options: ['step-free'],
  constraints: { useProfile: true, avoidStairs: true },
  lang: 'en',
});
```

The returned route options include ordered steps and node/edge IDs, floor-specific GeoJSON, distance, estimated duration and warnings. Only data returned by the API is drawn as a route. Search-index IDs should be used rather than invented node identifiers.

### Missing backend integrations

- No password reset endpoint; the app says so instead of submitting a made-up request.
- No student notifications or push notification registration endpoint; the Notifications tab currently shows an unavailable state.
- No standalone obstacle-report endpoint or photo upload. The available mobility event endpoint requires an active consented session and a campus coordinate.
- No pause endpoint for sharing. The app provides stop/revoke and automatic server expiry controls.
- The mobile app intentionally does not send location points. The backend accepts campus-local coordinates, but there is no validated phone-location-to-campus-coordinate workflow in this app.
- No STT API. TTS exists on the server, but the requested first version keeps both speech tools local and simulated.
- Registration exists on the backend; university/faculty attributes are not currently part of the student profile response.

## Accessibility and languages

The app supports system/light/dark themes, high contrast, text scaling, reduced motion, English/French/Arabic locale preferences, screen-reader labels on primary controls, and RTL row/text layout for Arabic. Preferences are persisted locally; backend-supported profile values are also synchronized. The campus route is assistive guidance and is not a safety guarantee.

The translation catalog is in `src/i18n/messages.ts`. Add equivalent keys in English, French, and Arabic before introducing user-facing strings. Map colors supplement labels and symbols; color is not the sole route distinction.

## Campus map and brand system

The indoor map is an SVG floor plan, not a GPS map provider. Building summaries, floor plans, and search results come from the Express campus API (`GET /api/campus/`, `/api/campus/floors/:id`, and `/api/campus/search-index`). Rooms, walls, passages, entrances, stairs, elevators, ramps, toilets, and facilities are rendered from the floor's returned GeoJSON layers. Route geometry and ordered instructions come from `POST /api/routes/plan`; the app does not invent route coordinates.

Backend floor `x`/`y` values are campus-local plan coordinates, not latitude/longitude. `src/utils/mapCoordinates.ts` maps them to the SVG viewport while accounting for the letterboxing caused by SVG's aspect-preserving `meet` behavior. Map taps in the empty margins are ignored; pan and zoom preserve the floor plan's aspect ratio, and each floor is rendered in its own coordinate space. The report form can open the map in point-selection mode and receives the selected local coordinates. Start and destination markers, route lines, floor-specific facility symbols, and a legend are drawn from backend data. Current-position and GPS behavior are not implemented because the API does not provide a verified position-to-floor-plan transform.

The palette and spacing tokens are centralized in `src/state/preferences.tsx`. The brand uses green-led surfaces, near-black structure, and the exact `#00A859` action accent, with light, dark, system, and high-contrast palettes. Prefer these tokens and shared controls in `src/components/ui.tsx` for new screens.

## Speech prototypes

The screens depend on `SpeechToTextService` and `TextToSpeechService` interfaces in `src/services/speech/`. Current `StaticSpeechToText` and `StaticTextToSpeech` implementations simulate a delay and playback state only. Replace the implementations and inject the new provider at the service boundary when real APIs are selected; the screens should not need provider-specific logic.

## Project structure

```text
mobile/
├── src/app/             Expo Router screens and route groups
├── src/api/             Centralized typed API modules and HTTP client
├── src/components/      Shared accessible controls and layout
├── src/i18n/            EN/FR/AR message catalogs
├── src/services/        Local saved places and replaceable speech services
├── src/state/           Auth and appearance/accessibility preferences
├── src/types/           Backend request/response types
└── assets/              Expo app assets
```

To add a screen, create a route under `src/app/`, reuse shared components from `src/components/ui.tsx`, and get colors/locale through `usePreferences()`. To add an API call, add typed request/response shapes to `src/types/api.ts`, add a method in the relevant `src/api/*.ts` module using `apiRequest`, and call it from a screen or query hook. Do not make raw fetch calls from screens.

## Checks

```bash
npm run typecheck
npm test -- --runInBand
npx expo-doctor
npx expo export --platform android
```

The unit tests cover the simulated speech lifecycle and the map coordinate conversion, letterbox taps, pan bounds, and aspect-preserving zoom. Device validation is still required for Android/iOS interaction, multi-touch behavior, SecureStore, and the backend's HttpOnly refresh cookie behavior.

## Known limitations

- No full native simulator/device session has been run as part of this initial implementation.
- Native cookie persistence for the backend refresh flow must be confirmed on target Android and iOS versions; access tokens are stored in SecureStore.
- No continuous/background tracking, map GPS origin, pause control, photo attachment, notifications, or official administrator analytics UI.
- Route correctness is bounded by backend graph data and the backend's current routing-engine implementation.
- Arabic RTL and larger text have source-level support but need visual device review with assistive technology.
