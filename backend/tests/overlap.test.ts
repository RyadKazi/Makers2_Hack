import { describe, expect, it } from 'vitest';
import { findConflicts, intervalProblem, overlaps } from '../src/modules/reservations/overlap.js';

const at = (hhmm: string): Date => new Date(`2026-11-20T${hhmm}:00.000Z`);
const iv = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });

describe('overlaps (half-open intervals)', () => {
  it.each([
    ['partial overlap at the start', iv('09:00', '10:00'), iv('09:30', '11:00'), true],
    ['partial overlap at the end', iv('10:30', '12:00'), iv('09:30', '11:00'), true],
    ['contained', iv('10:00', '10:30'), iv('09:30', '11:00'), true],
    ['containing', iv('09:00', '12:00'), iv('09:30', '11:00'), true],
    ['identical', iv('09:30', '11:00'), iv('09:30', '11:00'), true],
    ['back-to-back before', iv('08:00', '09:30'), iv('09:30', '11:00'), false],
    ['back-to-back after', iv('11:00', '12:30'), iv('09:30', '11:00'), false],
    ['disjoint', iv('13:00', '14:00'), iv('09:30', '11:00'), false],
  ])('%s', (_name, a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    expect(overlaps(b, a)).toBe(expected); // symmetric
  });
});

describe('findConflicts', () => {
  const existing = [
    { id: 'a', ...iv('08:00', '09:30') },
    { id: 'b', ...iv('09:40', '11:10') },
    { id: 'c', ...iv('11:20', '12:50') },
  ];

  it('returns every reservation the candidate collides with', () => {
    expect(findConflicts(iv('09:00', '11:30'), existing).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('allows slotting into the gaps', () => {
    expect(findConflicts(iv('09:30', '09:40'), existing)).toEqual([]);
  });

  it('ignores the reservation being updated', () => {
    expect(findConflicts(iv('09:45', '11:00'), existing, 'b')).toEqual([]);
    expect(findConflicts(iv('09:45', '11:30'), existing, 'b').map((r) => r.id)).toEqual(['c']);
  });
});

describe('intervalProblem', () => {
  const now = at('10:00');

  it('accepts a normal session', () => {
    expect(intervalProblem(iv('10:30', '12:00'), now)).toBeNull();
  });

  it('rejects end before or equal to start', () => {
    expect(intervalProblem(iv('11:00', '10:30'), now)).toBe('END_BEFORE_START');
    expect(intervalProblem(iv('11:00', '11:00'), now)).toBe('END_BEFORE_START');
  });

  it('enforces 15 min – 12 h', () => {
    expect(intervalProblem(iv('11:00', '11:10'), now)).toBe('TOO_SHORT');
    expect(intervalProblem({ startsAt: at('10:30'), endsAt: new Date(at('10:30').getTime() + 13 * 3_600_000) }, now)).toBe('TOO_LONG');
  });

  it('rejects starts in the past, with 5 minutes of tolerance', () => {
    expect(intervalProblem(iv('09:00', '10:30'), now)).toBe('IN_PAST');
    expect(intervalProblem(iv('09:56', '10:30'), now)).toBeNull();
    expect(intervalProblem(iv('09:00', '10:30'), now, false)).toBeNull(); // updating a running session
  });
});
