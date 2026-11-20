/** Demo accounts and today's timetable. Fictional people; the email domain is non-routable. */
import { algiersDayKey, algiersTime, type MobilityProfile } from './mobility.js';

export type SeedUser = {
  key: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CLUB';
  locale: 'ar' | 'fr' | 'en';
  profile?: {
    mobility: MobilityProfile;
    stepFree?: boolean;
    requireVerifiedRamps?: boolean;
    maxSlopePercent?: number;
    minPassageWidthCm?: number;
    audioGuidance?: boolean;
    shorelineHints?: boolean;
    captions?: boolean;
    textToSpeech?: boolean;
    highContrast?: boolean;
    textScale?: number;
  };
};

const DOMAIN = 'campusway.local';

export const USERS: SeedUser[] = [
  { key: 'admin', email: `admin@${DOMAIN}`, displayName: 'Administration du campus', role: 'ADMIN', locale: 'fr' },
  { key: 'benali', email: `benali@${DOMAIN}`, displayName: 'Dr. Benali', role: 'TEACHER', locale: 'fr' },
  { key: 'haddad', email: `haddad@${DOMAIN}`, displayName: 'Mme. Haddad', role: 'TEACHER', locale: 'ar' },
  {
    key: 'yacine',
    email: `yacine@${DOMAIN}`,
    displayName: 'Yacine B.',
    role: 'STUDENT',
    locale: 'fr',
    profile: { mobility: 'WHEELCHAIR', stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minPassageWidthCm: 85 },
  },
  {
    key: 'amina',
    email: `amina@${DOMAIN}`,
    displayName: 'Amina K.',
    role: 'STUDENT',
    locale: 'ar',
    profile: { mobility: 'BLIND_LOW_VISION', audioGuidance: true, shorelineHints: true, highContrast: true, textScale: 1.5 },
  },
  { key: 'karim', email: `karim@${DOMAIN}`, displayName: 'Karim M.', role: 'STUDENT', locale: 'fr', profile: { mobility: 'DEAF_HARD_OF_HEARING', captions: true } },
  { key: 'sara', email: `sara@${DOMAIN}`, displayName: 'Sara D.', role: 'STUDENT', locale: 'ar', profile: { mobility: 'SPEECH', textToSpeech: true } },
  { key: 'lina', email: `lina@${DOMAIN}`, displayName: 'Lina H.', role: 'STUDENT', locale: 'en', profile: { mobility: 'NONE' } },
  { key: 'riad', email: `riad@${DOMAIN}`, displayName: 'Riad S. (président, Robotics Club)', role: 'CLUB', locale: 'fr', profile: { mobility: 'NONE' } },
];

export type SeedReservation = {
  roomCode: string;
  kind: 'TEACHER' | 'ADMIN' | 'CLUB';
  title: string;
  organizer: string;
  userKey?: string;
  startsAt: Date;
  endsAt: Date;
};

/** Algerian university sessions of 1h30. */
const SLOTS: [number, number, number, number][] = [
  [8, 0, 9, 30],
  [9, 40, 11, 10],
  [11, 20, 12, 50],
  [13, 0, 14, 30],
  [14, 40, 16, 10],
];

/**
 * Today's timetable plus a few reservations anchored on "now", so the live
 * status demo always shows red / orange / green rooms whatever time it is:
 *   A-104 → occupied by Dr. Benali (red), B-212 → Robotics Club (orange), A-103 → available (green).
 */
export function buildReservations(now: Date): SeedReservation[] {
  const day = algiersDayKey(now);
  const slot = (i: number): { startsAt: Date; endsAt: Date } => {
    const [h1, m1, h2, m2] = SLOTS[i]!;
    return { startsAt: algiersTime(day, h1, m1), endsAt: algiersTime(day, h2, m2) };
  };
  const minutesFromNow = (m: number): Date => new Date(Math.floor(now.getTime() / 60_000) * 60_000 + m * 60_000);

  return [
    { roomCode: 'A-101', kind: 'TEACHER', title: 'Réseaux informatiques — Cours L3', organizer: 'Mme. Haddad', userKey: 'haddad', ...slot(0) },
    { roomCode: 'A-101', kind: 'TEACHER', title: 'Réseaux informatiques — TD L3', organizer: 'Mme. Haddad', userKey: 'haddad', ...slot(1) },
    { roomCode: 'A-102', kind: 'TEACHER', title: 'Algorithmique — TP L1', organizer: 'Dr. Benali', userKey: 'benali', ...slot(2) },
    { roomCode: 'A-201', kind: 'TEACHER', title: 'Analyse 1 — TD L1', organizer: 'Dr. Kaci', ...slot(0) },
    { roomCode: 'A-201', kind: 'TEACHER', title: 'Algèbre 1 — TD L1', organizer: 'Dr. Kaci', ...slot(2) },
    { roomCode: 'A-203', kind: 'TEACHER', title: 'Bases de données — TP L2', organizer: 'M. Boudiaf', ...slot(1) },
    { roomCode: 'A-203', kind: 'TEACHER', title: 'Bases de données — TP L2 (groupe 2)', organizer: 'M. Boudiaf', ...slot(2) },
    { roomCode: 'A-012', kind: 'ADMIN', title: 'Conseil de département', organizer: 'Chef de département', ...slot(2) },
    { roomCode: 'B-AMPHI1', kind: 'TEACHER', title: 'Structures de données — Cours magistral L2', organizer: 'Dr. Benali', userKey: 'benali', ...slot(1) },
    { roomCode: 'B-AMPHI1', kind: 'ADMIN', title: 'Réunion d’information — stages de fin d’études', organizer: 'Service des stages', ...slot(3) },
    { roomCode: 'B-101', kind: 'TEACHER', title: 'Systèmes d’exploitation — TD L2', organizer: 'Mme. Haddad', userKey: 'haddad', ...slot(0) },
    { roomCode: 'B-101', kind: 'TEACHER', title: 'Systèmes d’exploitation — TD L2 (groupe 2)', organizer: 'Mme. Haddad', userKey: 'haddad', ...slot(1) },
    { roomCode: 'B-201', kind: 'ADMIN', title: 'Examen de rattrapage — Probabilités', organizer: 'Service de scolarité', ...slot(2) },
    { roomCode: 'B-013', kind: 'CLUB', title: 'Club scientifique — préparation du hackathon', organizer: 'Club scientifique', ...slot(3) },
    { roomCode: 'B-102', kind: 'CLUB', title: 'Club Green Campus — réunion hebdomadaire', organizer: 'Club Green Campus', ...slot(4) },
    { roomCode: 'B-203', kind: 'CLUB', title: 'Robotics Club — atelier Arduino', organizer: 'Robotics Club', userKey: 'riad', ...slot(4) },
    // Anchored on "now" for a reliable live demo
    { roomCode: 'A-104', kind: 'TEACHER', title: 'Algorithmique avancée — TD L2', organizer: 'Dr. Benali', userKey: 'benali', startsAt: minutesFromNow(-30), endsAt: minutesFromNow(60) },
    { roomCode: 'A-104', kind: 'ADMIN', title: 'Soutenances de master', organizer: 'Département d’informatique', startsAt: minutesFromNow(75), endsAt: minutesFromNow(165) },
    { roomCode: 'B-212', kind: 'CLUB', title: 'Robotics Club — préparation de la compétition', organizer: 'Robotics Club', userKey: 'riad', startsAt: minutesFromNow(-15), endsAt: minutesFromNow(90) },
    { roomCode: 'A-103', kind: 'TEACHER', title: 'Physique 1 — TP L1', organizer: 'Mme. Haddad', userKey: 'haddad', startsAt: minutesFromNow(120), endsAt: minutesFromNow(210) },
  ];
}
