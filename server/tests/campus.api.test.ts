import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, seedTestDatabase, testApp } from './helpers/fixtures.js';

let app: Express;
let floorIds: Map<string, string>;

beforeAll(async () => {
  ({ floorIds } = await seedTestDatabase());
  app = testApp();
});
afterAll(() => prisma.$disconnect());

type Feature = { id: string; geometry: { type: string; coordinates: unknown[] } | null; properties: Record<string, unknown> };

describe('buildings and floors', () => {
  it('lists Bloc A and Bloc B with footprints and 3 floors each', async () => {
    const res = await request(app).get('/api/campus/buildings');
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { name: string }) => b.name)).toEqual(['Bloc A', 'Bloc B']);
    for (const b of res.body.items) {
      expect(b.footprint.type).toBe('Polygon');
      expect(b.floors.map((f: { level: number }) => f.level)).toEqual([0, 1, 2]);
    }
    expect(res.body.items[0].floors.reduce((n: number, f: { roomCount: number }) => n + f.roomCount, 0)).toBeGreaterThan(15);
  });

  it('lists the floors of a building by code or id, 404 otherwise', async () => {
    const byCode = await request(app).get('/api/campus/buildings/B/floors');
    expect(byCode.body.items).toHaveLength(3);
    const byId = await request(app).get(`/api/campus/buildings/${byCode.body.building.id}/floors`);
    expect(byId.body.building.code).toBe('B');
    expect((await request(app).get('/api/campus/buildings/Z/floors')).status).toBe(404);
  });
});

describe('GET /api/campus/floors/:id', () => {
  it('returns plan metadata and every layer as GeoJSON in campus metres', async () => {
    const res = await request(app).get(`/api/campus/floors/${floorIds.get('A0')}`);
    expect(res.status).toBe(200);
    expect(res.body.floor).toMatchObject({ level: 0, building: { code: 'A' } });
    expect(res.body.bounds).toEqual([15, 80, 105, 120]); // Bloc A footprint 20..100 × 85..115, padded 5 m
    expect(res.body.outline.type).toBe('Polygon');

    const { layers } = res.body;
    expect(Object.keys(layers).sort()).toEqual(
      ['accessible_toilets', 'elevators', 'entrances', 'facilities', 'passages', 'ramps', 'rooms', 'stairs', 'toilets', 'walls'].sort(),
    );
    const library = layers.rooms.features.find((f: Feature) => f.properties.code === 'A-BIB');
    expect(library.geometry.type).toBe('Polygon');
    expect(library.properties.status).toHaveProperty('status');
    expect(layers.elevators.features).toHaveLength(1);
    expect(layers.elevators.features[0].geometry).toEqual({ type: 'Point', coordinates: [54.5, 106] });
    expect(layers.entrances.features.map((f: Feature) => f.properties.name)).toContain('Entrée principale Bloc A');
    expect(layers.walls.features.length).toBeGreaterThan(10);
    expect(layers.walls.features[0].geometry.type).toBe('LineString');
  });

  it('shows the closed footbridge as a passage with isOpen=false on level 1', async () => {
    const res = await request(app).get(`/api/campus/floors/${floorIds.get('A1')}/layers?types=passages`);
    const bridge = res.body.layers.passages.features.find((f: Feature) => f.id === 'E-A1-C78--B1-C02');
    expect(bridge.properties).toMatchObject({ isOpen: false, closedReason: expect.stringContaining('travaux') });
    // Vertical links (stairs between floors) are not drawn on a 2D plan.
    expect(res.body.layers.passages.features.some((f: Feature) => f.id === 'E-A0-STAIRS--A1-STAIRS')).toBe(false);
  });

  it('returns only the requested layers', async () => {
    const res = await request(app).get(`/api/campus/floors/${floorIds.get('B0')}/layers?types=elevators,accessible_toilets`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.layers).sort()).toEqual(['accessible_toilets', 'elevators']);
    expect(res.body.layers.accessible_toilets.features[0].properties).toMatchObject({ accessible: true, layer: 'accessible_toilets' });
  });

  it('validates layer names and floor ids', async () => {
    expect((await request(app).get(`/api/campus/floors/${floorIds.get('B0')}/layers?types=rooms,lava`)).status).toBe(400);
    expect((await request(app).get('/api/campus/floors/unknown')).status).toBe(404);
  });
});

describe('GET /api/campus', () => {
  it('returns bounds, geofence, buildings and outdoor layers', async () => {
    const res = await request(app).get('/api/campus');
    expect(res.status).toBe(200);
    expect(res.body.bounds).toEqual([0, 0, 220, 150]);
    expect(res.body.geofence.type).toBe('Polygon');
    expect(res.body.buildings).toHaveLength(2);
    expect(res.body.outdoor.entrances.features.map((f: Feature) => f.properties.name)).toContain('Portail principal');
    const ramp = res.body.outdoor.passages.features.find((f: Feature) => f.id === 'E-O-BIB-RAMP-BOT--O-BIB-LANDING');
    expect(ramp.properties).toMatchObject({ isRamp: true, slopePercent: 12, verified: false });
    expect(res.body.outdoor.walls.features.some((f: Feature) => f.properties.kind === 'CURB')).toBe(true);
  });
});

describe('GET /api/campus/search-index', () => {
  it('lists rooms, buildings with floors, POIs and upcoming clubs', async () => {
    const res = await request(app).get('/api/campus/search-index');
    expect(res.status).toBe(200);
    expect(res.body.rooms).toHaveLength(44);
    expect(res.body.rooms.find((r: { code: string }) => r.code === 'A-BIB')).toMatchObject({ type: 'LIBRARY', buildingCode: 'A', level: 0, nameAr: 'المكتبة المركزية' });
    expect(res.body.buildings.map((b: { code: string; floors: unknown[] }) => [b.code, b.floors.length])).toEqual([
      ['A', 3],
      ['B', 3],
    ]);
    expect(res.body.pois.some((p: { type: string; floorId: string | null }) => p.type === 'PARKING_ACCESSIBLE' && p.floorId === null)).toBe(true);
    const robotics = res.body.clubs.find((c: { name: string }) => c.name === 'Robotics Club');
    expect(robotics).toMatchObject({ roomCode: expect.stringMatching(/^B-/) });
  });
});
