import { describe, expect, it } from 'vitest';
import type { RoomSummary } from '@/api/types';
import { editDistance, fuzzySearch, normalize, prepare, wordsOf } from '@/lib/search';
import { formatTime, formatUnit } from '@/lib/format';
import { filterByCapacity, freeText, paginate, sortRooms, statusLine } from '@/features/rooms/roomModel';
import { nextInDirection, readingOrder } from './spatialNav';

describe('fuzzy search (AR / FR / EN)', () => {
  const items = [
    prepare({ id: 'bib' }, ['A-BIB', 'Bibliothèque centrale', 'المكتبة المركزية', 'library']),
    prepare({ id: 'a104' }, ['A-104', 'Salle de TD A-104']),
    prepare({ id: 'amphi' }, ['B-AMPHI1', 'Amphi 1', 'المدرج 1', 'lecture hall']),
    prepare({ id: 'wc' }, ['Toilettes accessibles (PMR)', 'دورات مياه مهيأة', 'accessible toilets']),
    prepare({ id: 'robot' }, ['Robotics Club', 'club']),
  ];
  const top = (q: string) => fuzzySearch(items, q)[0]?.item.id;

  it('normalises accents, case and Arabic letter variants', () => {
    expect(normalize('Bibliothèque CENTRALE')).toBe('bibliotheque centrale');
    expect(normalize('مَكْتَبَةٌ')).toBe('مكتبه');
    expect(normalize('أإآ')).toBe('ااا');
    expect(wordsOf('المكتبة')).toEqual(expect.arrayContaining(['المكتبه', 'مكتبه']));
  });

  it.each([
    ['bibliotheque', 'bib'],
    ['biblio', 'bib'],
    ['libary', 'bib'], // typo
    ['مكتبة', 'bib'], // without the article
    ['المكتبه', 'bib'],
    ['a104', 'a104'], // code without separator
    ['a 104', 'a104'],
    ['amphi', 'amphi'],
    ['مدرج', 'amphi'],
    ['toilette pmr', 'wc'],
    ['robotcs', 'robot'], // typo
  ])('"%s" → %s', (q, expected) => {
    expect(top(q)).toBe(expected);
  });

  it('requires every word to match, and rejects nonsense', () => {
    expect(fuzzySearch(items, 'library zzz')).toEqual([]);
    expect(fuzzySearch(items, 'qwxz')).toEqual([]);
    expect(fuzzySearch(items, '  ')).toEqual([]);
  });

  it('counts transpositions as one edit', () => {
    expect(editDistance('club', 'culb')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2); // stopped early above the limit
  });
});

describe('spatial navigation', () => {
  const pts = [
    { id: 'center', x: 50, y: 50 },
    { id: 'east', x: 70, y: 52 },
    { id: 'far-east', x: 95, y: 50 },
    { id: 'north', x: 51, y: 70 },
    { id: 'north-east-diag', x: 70, y: 75 },
    { id: 'west', x: 20, y: 50 },
  ];
  it('goes to the nearest item straight ahead (screen directions, north up)', () => {
    expect(nextInDirection(pts[0]!, pts, 'right')).toBe('east');
    expect(nextInDirection(pts[0]!, pts, 'up')).toBe('north');
    expect(nextInDirection(pts[0]!, pts, 'left')).toBe('west');
    expect(nextInDirection(pts[0]!, pts, 'down')).toBeNull();
    expect(nextInDirection(pts[1]!, pts, 'right')).toBe('far-east');
  });

  it('orders items for Tab in reading order (mirrored in RTL)', () => {
    const order = readingOrder([{ id: 'sw', x: 0, y: 0 }, { id: 'ne', x: 10, y: 20 }, { id: 'nw', x: 0, y: 20 }], false).map((p) => p.id);
    expect(order).toEqual(['nw', 'ne', 'sw']);
    expect(readingOrder([{ id: 'w', x: 0, y: 0 }, { id: 'e', x: 10, y: 0 }], true).map((p) => p.id)).toEqual(['e', 'w']);
  });
});

describe('room wording, filters and sorting', () => {
  const t = (key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ''}`;
  const now = new Date('2026-11-20T10:00:00Z'); // 11:00 in Algiers
  const room = (code: string, status: RoomSummary['status']['status'], capacity: number, freeAt: string, until: string | null): RoomSummary =>
    ({ code, capacity, status: { status, label: status, occupantName: null, title: null, reservationId: null, until, freeAt } }) as RoomSummary;
  const rooms = [
    room('A-10', 'TEACHER', 40, '2026-11-20T12:00:00Z', '2026-11-20T11:00:00Z'),
    room('A-2', 'AVAILABLE', 20, '2026-11-20T10:00:00Z', '2026-11-20T13:00:00Z'),
    room('B-1', 'CLUB', 120, '2026-11-20T11:00:00Z', '2026-11-20T11:00:00Z'),
  ];

  it('describes status with campus-time "until" / "free at"', () => {
    expect(statusLine(rooms[1]!.status, t, 'fr', now)).toBe('AVAILABLE · time.until{"time":"14:00"}');
    expect(freeText(rooms[0]!.status, t, 'fr', now)).toBe('time.freeAt{"time":"13:00"}');
    expect(freeText(room('X', 'AVAILABLE', 1, '', null).status, t, 'fr', now)).toBe('time.freeAllDay');
  });

  it('sorts naturally by code, by capacity, by soonest free and by status', () => {
    expect(sortRooms(rooms, 'code', now).map((r) => r.code)).toEqual(['A-2', 'A-10', 'B-1']);
    expect(sortRooms(rooms, 'capacity', now).map((r) => r.code)).toEqual(['B-1', 'A-10', 'A-2']);
    expect(sortRooms(rooms, 'free', now).map((r) => r.code)).toEqual(['A-2', 'B-1', 'A-10']);
    expect(sortRooms(rooms, 'status', now).map((r) => r.code)).toEqual(['A-2', 'B-1', 'A-10']);
  });

  it('filters by capacity range and paginates', () => {
    expect(filterByCapacity(rooms, 30, 100).map((r) => r.code)).toEqual(['A-10']);
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pages: 3 });
    expect(paginate([1, 2], 9, 2).page).toBe(1);
  });

  it('formats campus times and units per language', () => {
    expect(formatTime('2026-11-20T13:00:00Z', 'ar', now)).toBe('14:00');
    expect(formatTime('2026-11-21T07:00:00Z', 'en', now)).toBe('Sat 08:00');
    expect(formatUnit(90, 'centimeter', 'ar')).toBe('90 سم');
  });
});
