export type Locale = 'en' | 'fr' | 'ar';
export type MobilityProfile = 'NONE' | 'WHEELCHAIR' | 'REDUCED_MOBILITY' | 'BLIND_LOW_VISION' | 'DEAF_HARD_OF_HEARING' | 'SPEECH';

export type AccessibilityProfile = {
  mobility: MobilityProfile;
  stepFree: boolean;
  requireVerifiedRamps: boolean;
  maxSlopePercent: number | null;
  minPassageWidthCm: number | null;
  avoidClosedPassages: boolean;
  audioGuidance: boolean;
  shorelineHints: boolean;
  captions: boolean;
  textToSpeech: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  textScale: number;
  updatedAt: string | null;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CLUB';
  locale: Locale;
  createdAt: string;
  accessibilityProfile: AccessibilityProfile;
};

export type AuthSession = { accessToken: string; tokenType: 'Bearer'; expiresIn: number; user: User };
export type Position = [x: number, y: number] | [x: number, y: number, z: number];
export type GeoGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };
export type GeoFeature<P = Record<string, unknown>> = { type: 'Feature'; id: string; geometry: GeoGeometry | null; properties: P };
export type FeatureCollection<P = Record<string, unknown>> = { type: 'FeatureCollection'; features: GeoFeature<P>[] };

export type FloorRef = { id: string; level: number; name: string; elevationM?: number; roomCount?: number };
export type Building = { id: string; code: string; name: string; nameAr: string; floors: FloorRef[]; x?: number; y?: number; footprint?: GeoGeometry | null };
export type CampusOverview = {
  campus: { id: string; name: string; nameAr: string; timezone: string };
  bounds: [number, number, number, number];
  geofence: GeoGeometry | null;
  buildings: Building[];
  outdoor: Record<string, FeatureCollection>;
};

export type RoomSearchItem = { id: string; code: string; name: string; nameAr: string | null; type: string; buildingCode: string; floorId: string; level: number };
export type PoiSearchItem = { id: string; type: string; name: string; nameAr: string | null; floorId: string | null; level: number; buildingCode: string | null; x: number; y: number };
export type SearchIndex = { generatedAt: string; buildings: Building[]; rooms: RoomSearchItem[]; pois: PoiSearchItem[]; clubs: { name: string; roomCode: string; floorId: string; title: string; startsAt: string; endsAt: string }[] };

export type LayerProperties = {
  layer?: string; name?: string; nameAr?: string | null; code?: string; type?: string; accessible?: boolean;
  isOpen?: boolean; closedReason?: string | null; hasStairs?: boolean; stepCount?: number; isRamp?: boolean;
  slopePercent?: number; widthCm?: number; doorClearanceCm?: number | null; surface?: string; verified?: boolean;
  status?: { status: string; label: string; occupantName: string | null; title: string | null };
  kind?: string; label?: string | null; [key: string]: unknown;
};
export type FloorLayers = Record<string, FeatureCollection<LayerProperties> | undefined>;
export type FloorPlan = { floor: FloorRef & { building: { id: string; code: string; name: string; nameAr: string } }; bounds: [number, number, number, number]; outline: GeoGeometry | null; layers: FloorLayers; at: string };

export type RouteLocation =
  | { type: 'room' | 'poi' | 'node'; id: string }
  | { type: 'point'; x: number; y: number; level: number; floorId?: string };
export type RouteStep = { index: number; type: string; instruction: string; distanceM: number; turn: string | null; fromNodeId: string; toNodeId: string; edgeIds: string[]; level: number; toLevel: number | null; floorId: string | null; x: number; y: number; landmark: string | null; shoreline: { side: string; feature: string; distanceM: number; offsetM: number | null; hint: string | null } | null };
export type RouteOption = { id: 'fastest' | 'step-free'; label: string; stepFree: boolean; distanceM: number; etaSec: number; travelMode: 'walking' | 'wheelchair'; elevatorCount: number; rampCount: number; stairsCount: number; levels: number[]; warnings: { code: string; message: string }[]; nodeIds: string[]; edgeIds: string[]; steps: RouteStep[]; geojson: { floorId: string | null; level: number; buildingCode: string | null; featureCollection: FeatureCollection }[] };
export type RouteUnavailable = { option: string; reason: string; message: string; blockers: { constraint: string; message: string; edges: { edgeId: string; description: string; value: string | number | null; limit: string | number | null }[] }[] };
export type RoutePlan = { routeId: string | null; version: number; engine: string; from: { type: string; nodeId: string; name: string; level: number; floorId: string | null; x: number; y: number; snappedDistanceM: number | null }; to: { type: string; nodeId: string; name: string; level: number; floorId: string | null; x: number; y: number; snappedDistanceM: number | null }; travelMode: 'walking' | 'wheelchair'; options: RouteOption[]; unavailable: RouteUnavailable[] };

export type MobilityConsent = { granted: boolean; upToDate: boolean; policyVersion: string | null; grantedAt: string | null; revokedAt: string | null; currentPolicy: { version: string; summary: string[]; retentionDays: number } };
export type MobilitySession = { id: string; needsCategory: MobilityProfile; startedAt: string; endedAt: string | null; endReason: string | null; pointCount: number; lastPointAt: string | null; autoStopAt: string; autoStopReason: string; remainingSec: number; reminder: string | null };
export type MobilityStatus = { state: 'NONE' | 'ACTIVE' | 'ENDED'; message: string | null; session: MobilitySession | null };
export type DifficultyType = 'BLOCKED' | 'TOO_STEEP' | 'HARD_TO_NAVIGATE';
export type SpeechStatus = { tts: { available: boolean; provider: 'cartesia'; model: string; languages: Locale[]; maxChars: number } };
