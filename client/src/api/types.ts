/**
 * Types generated from the server OpenAPI document (npm run api:sync).
 * Never hand-write API shapes: re-export them from here.
 */
import type { components, paths } from './schema';

export type Schemas = components['schemas'];
export type ApiPaths = paths;

export type Me = Schemas['Me'];
export type AccessibilityProfile = Schemas['AccessibilityProfile'];
export type UpdateAccessibilityProfile = Schemas['UpdateAccessibilityProfile'];
export type AuthSession = Schemas['AuthSession'];
export type MobilityProfile = Schemas['MobilityProfile'];
export type RoomStatus = Schemas['RoomStatus'];
export type RoomStatusCode = Schemas['RoomStatusCode'];
export type RoomSummary = Schemas['RoomSummary'];
export type RoomList = Schemas['RoomList'];
export type Building = Schemas['Building'];
export type BuildingList = Schemas['BuildingList'];
export type ApiError = Schemas['ErrorResponse'];
export type RoomDetail = Schemas['RoomDetail'];
export type Reservation = Schemas['Reservation'];
export type NearbyPoi = Schemas['NearbyPoi'];
export type FloorPlan = Schemas['FloorPlan'];
export type CampusOverview = Schemas['CampusOverview'];
export type SearchIndex = Schemas['SearchIndex'];
export type RoomFeature = Schemas['RoomFeature'];
export type PoiFeature = Schemas['PoiFeature'];
export type WallFeature = Schemas['WallFeature'];
export type PassageFeature = Schemas['PassageFeature'];
export type Geometry = Schemas['Geometry'];
export type RoomType = Schemas['RoomType'];
export type RoutePlan = Schemas['RoutePlan'];
export type RouteOption = Schemas['RouteOption'];
export type RouteOptionId = RouteOption['id'];
export type RouteStep = Schemas['RouteStep'];
export type RouteUnavailable = Schemas['RouteUnavailable'];
export type ResolvedLocation = Schemas['ResolvedLocation'];
export type PlanRouteRequest = Schemas['PlanRouteRequest'];
export type RouteLocation = Schemas['RouteLocation'];
export type RouteConstraintsInput = Schemas['RouteConstraintsInput'];
export type RouteRecheck = Schemas['RouteRecheck'];
export type RecheckRouteRequest = Schemas['RecheckRouteRequest'];
export type MobilityConsent = Schemas['MobilityConsent'];
export type MobilitySessionStatus = Schemas['MobilitySessionStatus'];
export type MobilityPointsBatch = Schemas['MobilityPointsBatch'];
export type MobilityEventReport = Schemas['MobilityEventReport'];
export type SpeechStatus = Schemas['SpeechStatus'];
