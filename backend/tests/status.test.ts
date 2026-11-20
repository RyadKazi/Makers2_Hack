import { describe, expect, it } from 'vitest';
import { computeRoomStatus, statusLabel, toRoomStatusDto, type ReservationSlot } from '../src/modules/rooms/status.js';

const at = (hhmm: string): Date => new Date(`2026-11-19T${hhmm}:00.000Z`);
const slot = (id: string, kind: ReservationSlot['kind'], from: string, to: string, organizer = `org-${id}`): ReservationSlot => ({
  id,
  kind,
  title: `Session ${id}`,
  organizer,
  startsAt: at(from),
  endsAt: at(to),
});

describe('computeRoomStatus', () => {
  it('is AVAILABLE with no reservations, free now, no "until"', () => {
    const s = computeRoomStatus([], at('10:00'));
    expect(s).toMatchObject({ status: 'AVAILABLE', occupantName: null, title: null, reservationId: null, until: null });
    expect(s.freeAt).toEqual(at('10:00'));
  });

  it('is AVAILABLE until the next reservation starts', () => {
    const s = computeRoomStatus([slot('late', 'CLUB', '14:00', '15:30'), slot('next', 'TEACHER', '11:00', '12:30')], at('10:00'));
    expect(s.status).toBe('AVAILABLE');
    expect(s.until).toEqual(at('11:00'));
  });

  it.each(['TEACHER', 'ADMIN', 'CLUB'] as const)('reports a running %s reservation with occupant and end time', (kind) => {
    const s = computeRoomStatus([slot('r1', kind, '09:30', '11:00', 'Dr. Benali')], at('10:00'));
    expect(s).toMatchObject({ status: kind, occupantName: 'Dr. Benali', title: 'Session r1', reservationId: 'r1' });
    expect(s.until).toEqual(at('11:00'));
    expect(s.freeAt).toEqual(at('11:00'));
  });

  it('uses half-open intervals: running at its start, finished at its end', () => {
    const r = [slot('r1', 'TEACHER', '08:00', '09:30')];
    expect(computeRoomStatus(r, at('08:00')).status).toBe('TEACHER');
    expect(computeRoomStatus(r, at('09:30')).status).toBe('AVAILABLE');
  });

  it('hands over to a back-to-back reservation exactly at the boundary', () => {
    const r = [slot('a', 'TEACHER', '08:00', '09:30'), slot('b', 'CLUB', '09:30', '11:00')];
    const s = computeRoomStatus(r, at('09:30'));
    expect(s).toMatchObject({ status: 'CLUB', reservationId: 'b' });
  });

  it('freeAt follows a chain of back-to-back reservations but stops at a gap', () => {
    const r = [
      slot('a', 'TEACHER', '08:00', '09:30'),
      slot('b', 'TEACHER', '09:30', '11:00'),
      slot('c', 'ADMIN', '11:00', '12:30'),
      slot('d', 'CLUB', '13:00', '14:30'), // 30-minute gap: room is free at 12:30
    ];
    const s = computeRoomStatus(r, at('08:15'));
    expect(s.until).toEqual(at('09:30')); // end of the current one
    expect(s.freeAt).toEqual(at('12:30')); // really free
  });

  it('ignores reservations that already ended', () => {
    const s = computeRoomStatus([slot('old', 'TEACHER', '06:00', '07:30')], at('10:00'));
    expect(s).toMatchObject({ status: 'AVAILABLE', until: null });
  });

  it('prefers ADMIN > TEACHER > CLUB if bad data overlaps', () => {
    const r = [slot('club', 'CLUB', '09:00', '12:00'), slot('admin', 'ADMIN', '09:30', '10:30'), slot('t', 'TEACHER', '09:45', '10:15')];
    expect(computeRoomStatus(r, at('10:00')).reservationId).toBe('admin');
  });

  it('does not depend on input order', () => {
    const r = [slot('b', 'TEACHER', '09:30', '11:00'), slot('a', 'TEACHER', '08:00', '09:30')];
    expect(computeRoomStatus(r, at('08:30')).freeAt).toEqual(at('11:00'));
    expect(computeRoomStatus([...r].reverse(), at('08:30')).freeAt).toEqual(at('11:00'));
  });
});

describe('status DTO', () => {
  it('serialises dates as ISO strings and localises the label', () => {
    const dto = toRoomStatusDto(computeRoomStatus([slot('r', 'CLUB', '09:00', '10:00', 'Robotics Club')], at('09:15')), 'en');
    expect(dto).toEqual({
      status: 'CLUB',
      label: 'Occupied — club',
      occupantName: 'Robotics Club',
      title: 'Session r',
      reservationId: 'r',
      until: '2026-11-19T10:00:00.000Z',
      freeAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('has a label for every status in every language', () => {
    for (const lang of ['ar', 'fr', 'en'] as const)
      for (const status of ['AVAILABLE', 'TEACHER', 'ADMIN', 'CLUB'] as const) expect(statusLabel(status, lang).length).toBeGreaterThan(2);
    expect(statusLabel('AVAILABLE', 'ar')).toBe('متاحة');
  });
});
