import { apiRequest } from './client';
import type { Locale } from '@/types/api';

export type RoomStatusCode = 'AVAILABLE' | 'TEACHER' | 'ADMIN' | 'CLUB';

export type RoomStatus = {
  status: RoomStatusCode;
  label: string;
  occupantName: string | null;
  title: string | null;
  reservationId: string | null;
  until: string | null;
  freeAt: string;
};

export type RoomSummary = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  capacity: number;
  wheelchairSpaces: number;
  hearingLoop: boolean;
  building: { id: string; code: string; name: string };
  floor: { id: string; level: number; name: string };
  x: number;
  y: number;
  stepFreeAccess: boolean;
  status: RoomStatus;
};

export type RoomDetail = RoomSummary & {
  schedule: Array<{
    id: string;
    roomId: string;
    roomCode: string;
    kind: 'TEACHER' | 'ADMIN' | 'CLUB';
    title: string;
    organizer: string;
    startsAt: string;
    endsAt: string;
  }>;
  accessibility: {
    stepFreeAccess: boolean;
    wheelchairAccessible: boolean;
    doorClearanceCm: number | null;
    wheelchairSpaces: number;
    hearingLoop: boolean;
  };
  nearest: {
    elevator: { id: string; name: string; distanceM: number } | null;
    accessibleToilet: { id: string; name: string; distanceM: number } | null;
  };
};

export type RoomListParams = {
  search?: string;
  status?: string;
  buildingId?: string;
  floor?: number;
  minCapacity?: number;
  stepFree?: boolean;
  limit?: number;
  offset?: number;
  lang?: Locale;
};

export const MOCK_ROOMS: RoomSummary[] = [
  {
    id: 'room-a-101',
    code: 'A-101',
    name: 'Amphithéâtre Turing',
    nameAr: 'مدرج تورينغ',
    type: 'AMPHI',
    capacity: 180,
    wheelchairSpaces: 4,
    hearingLoop: true,
    building: { id: 'bld-a', code: 'A', name: 'Bâtiment Sciences & Tech' },
    floor: { id: 'fl-a-0', level: 0, name: 'RDC' },
    x: 42,
    y: 65,
    stepFreeAccess: true,
    status: {
      status: 'AVAILABLE',
      label: 'Disponible',
      occupantName: null,
      title: null,
      reservationId: null,
      until: null,
      freeAt: 'Maintenant',
    },
  },
  {
    id: 'room-a-104',
    code: 'A-104',
    name: 'Salle Multimédia 104',
    nameAr: 'قاعة الوسائط 104',
    type: 'TD',
    capacity: 35,
    wheelchairSpaces: 2,
    hearingLoop: true,
    building: { id: 'bld-a', code: 'A', name: 'Bâtiment Sciences & Tech' },
    floor: { id: 'fl-a-0', level: 0, name: 'RDC' },
    x: 88,
    y: 112,
    stepFreeAccess: true,
    status: {
      status: 'TEACHER',
      label: 'Cours Dr. Benali',
      occupantName: 'Dr. Benali',
      title: 'Algorithmique & Structures de données',
      reservationId: 'res-104',
      until: '11:30',
      freeAt: '11:30',
    },
  },
  {
    id: 'room-b-201',
    code: 'B-201',
    name: 'Laboratoire Réseaux',
    nameAr: 'مخبر الشبكات',
    type: 'LAB',
    capacity: 28,
    wheelchairSpaces: 2,
    hearingLoop: false,
    building: { id: 'bld-b', code: 'B', name: 'Pôle Informatique' },
    floor: { id: 'fl-b-1', level: 1, name: 'Étage 1' },
    x: 120,
    y: 84,
    stepFreeAccess: true,
    status: {
      status: 'AVAILABLE',
      label: 'Disponible',
      occupantName: null,
      title: null,
      reservationId: null,
      until: null,
      freeAt: 'Maintenant',
    },
  },
  {
    id: 'room-b-212',
    code: 'B-212',
    name: 'Salle de Travail Collaboratif',
    nameAr: 'قاعة العمل التشاركي',
    type: 'MEETING',
    capacity: 16,
    wheelchairSpaces: 1,
    hearingLoop: true,
    building: { id: 'bld-b', code: 'B', name: 'Pôle Informatique' },
    floor: { id: 'fl-b-1', level: 1, name: 'Étage 1' },
    x: 165,
    y: 95,
    stepFreeAccess: true,
    status: {
      status: 'CLUB',
      label: 'Club GDG Campus',
      occupantName: 'Yacine (Club GDG)',
      title: 'Atelier Mobile & React Native',
      reservationId: 'res-212',
      until: '16:00',
      freeAt: '16:00',
    },
  },
  {
    id: 'room-c-002',
    code: 'C-002',
    name: 'Salle des Conférences',
    nameAr: 'قاعة المحاضرات الكبرى',
    type: 'AMPHI',
    capacity: 250,
    wheelchairSpaces: 6,
    hearingLoop: true,
    building: { id: 'bld-c', code: 'C', name: 'Maison de l’Étudiant' },
    floor: { id: 'fl-c-0', level: 0, name: 'RDC' },
    x: 55,
    y: 190,
    stepFreeAccess: true,
    status: {
      status: 'ADMIN',
      label: 'Réservé Administration',
      occupantName: 'Direction Pédagogique',
      title: 'Séance d’Orientation Semestre 2',
      reservationId: 'res-admin-01',
      until: '14:00',
      freeAt: '14:00',
    },
  },
  {
    id: 'room-c-105',
    code: 'C-105',
    name: 'Espace Associatif',
    nameAr: 'فضاء النوادي الطلابية',
    type: 'MEETING',
    capacity: 40,
    wheelchairSpaces: 3,
    hearingLoop: false,
    building: { id: 'bld-c', code: 'C', name: 'Maison de l’Étudiant' },
    floor: { id: 'fl-c-1', level: 1, name: 'Étage 1' },
    x: 92,
    y: 140,
    stepFreeAccess: false,
    status: {
      status: 'AVAILABLE',
      label: 'Disponible',
      occupantName: null,
      title: null,
      reservationId: null,
      until: null,
      freeAt: 'Maintenant',
    },
  },
];

export const roomsApi = {
  list: async (params?: RoomListParams): Promise<{ items: RoomSummary[]; total: number }> => {
    try {
      const q = new URLSearchParams();
      if (params?.search) q.append('search', params.search);
      if (params?.status) q.append('status', params.status);
      if (params?.buildingId) q.append('buildingId', params.buildingId);
      if (params?.floor !== undefined) q.append('floor', String(params.floor));
      if (params?.minCapacity) q.append('minCapacity', String(params.minCapacity));
      if (params?.stepFree) q.append('stepFree', 'true');
      if (params?.lang) q.append('lang', params.lang);

      const res = await apiRequest<{ items: RoomSummary[]; total: number }>(`/rooms?${q.toString()}`, {
        locale: params?.lang ?? 'en',
      });
      if (res && res.items && res.items.length > 0) return res;
    } catch {
      // Fallback to local mock data
    }

    let filtered = [...MOCK_ROOMS];
    if (params?.search) {
      const s = params.search.toLowerCase();
      filtered = filtered.filter(
        r => r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.nameAr && r.nameAr.includes(s))
      );
    }
    if (params?.status && params.status !== 'ALL') {
      filtered = filtered.filter(r => r.status.status === params.status);
    }
    if (params?.stepFree) {
      filtered = filtered.filter(r => r.stepFreeAccess);
    }
    if (params?.minCapacity) {
      filtered = filtered.filter(r => r.capacity >= params.minCapacity!);
    }
    return { items: filtered, total: filtered.length };
  },

  get: async (idOrCode: string, locale: Locale = 'en'): Promise<RoomDetail> => {
    try {
      const res = await apiRequest<RoomDetail>(`/rooms/${encodeURIComponent(idOrCode)}?lang=${locale}`, { locale });
      if (res && res.code) return res;
    } catch {
      // Fallback
    }

    const item = MOCK_ROOMS.find(r => r.id === idOrCode || r.code === idOrCode) || MOCK_ROOMS[0];
    return {
      ...item,
      schedule: [
        {
          id: 's-1',
          roomId: item.id,
          roomCode: item.code,
          kind: item.status.status === 'AVAILABLE' ? 'TEACHER' : item.status.status,
          title: item.status.title || 'Séance de cours programmée',
          organizer: item.status.occupantName || 'Département Informatique',
          startsAt: '09:00',
          endsAt: '11:00',
        },
        {
          id: 's-2',
          roomId: item.id,
          roomCode: item.code,
          kind: 'CLUB',
          title: 'Réunion Bureau Étudiant',
          organizer: 'Club Campus Way',
          startsAt: '14:30',
          endsAt: '16:00',
        },
      ],
      accessibility: {
        stepFreeAccess: item.stepFreeAccess,
        wheelchairAccessible: item.wheelchairSpaces > 0,
        doorClearanceCm: 90,
        wheelchairSpaces: item.wheelchairSpaces,
        hearingLoop: item.hearingLoop,
      },
      nearest: {
        elevator: { id: 'elev-1', name: 'Ascenseur Central A', distanceM: 18 },
        accessibleToilet: { id: 'wc-1', name: 'Sanitaires PMR RDC', distanceM: 24 },
      },
    };
  },
};
