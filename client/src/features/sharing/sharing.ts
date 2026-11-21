/**
 * Voluntary location sharing (crowdsourced mobility data). Opt-in with consent to the
 * current policy; the server pseudonymises, geofences and auto-stops sessions.
 * While sharing is on, positions are sent in batches, tagged with the route being followed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorCode } from '@/api/client';
import type { MobilityConsent, MobilityPointsBatch, MobilitySessionStatus } from '@/api/types';
import { useAuth } from '@/stores/auth';
import type { Position } from '@/features/navigate/position';

export const sharingKeys = {
  consent: ['mobility', 'consent'] as const,
  session: ['mobility', 'session'] as const,
};

export function useConsent() {
  const { i18n } = useTranslation();
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: [...sharingKeys.consent, i18n.language],
    queryFn: async () => (await api.get<MobilityConsent>('/api/mobility/consent', { params: { lang: i18n.language } })).data,
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

export function useSharingStatus() {
  const { i18n } = useTranslation();
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: [...sharingKeys.session, i18n.language],
    queryFn: async () => (await api.get<MobilitySessionStatus>('/api/mobility/sessions/current', { params: { lang: i18n.language } })).data,
    enabled: signedIn,
    // Auto-stop (3 h, midnight, leaving campus) and the reminder come from the server.
    refetchInterval: (q) => (q.state.data?.state === 'ACTIVE' ? 60_000 : false),
  });
}

export function useStartSharing() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  return useMutation({
    mutationFn: async ({ policyVersion, grantConsent }: { policyVersion: string; grantConsent: boolean }) => {
      if (grantConsent) await api.post('/api/mobility/consent', { policyVersion, lang: i18n.language });
      return (await api.post<MobilitySessionStatus>('/api/mobility/sessions', { lang: i18n.language })).data;
    },
    onSuccess: (status) => {
      qc.setQueryData([...sharingKeys.session, i18n.language], status);
      void qc.invalidateQueries({ queryKey: sharingKeys.consent });
    },
  });
}

export function useStopSharing() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  return useMutation({
    mutationFn: async (sessionId: string) => (await api.post<MobilitySessionStatus>(`/api/mobility/sessions/${sessionId}/stop`, null, { params: { lang: i18n.language } })).data,
    onSuccess: (status) => qc.setQueryData([...sharingKeys.session, i18n.language], status),
  });
}

export const activeSessionId = (status: MobilitySessionStatus | undefined): string | null => (status?.state === 'ACTIVE' ? (status.session?.id ?? null) : null);

// ───────────── point logger ─────────────

type BatchPoint = MobilityPointsBatch['points'][number];

/** Server limits: ≤ 100 points per batch, accuracy ≤ 10 m (worse points are not sent). */
export const MAX_BATCH = 100;
export const MAX_ACCURACY_M = 10;
const FLUSH_MS = 10_000;
const MIN_MOVE_M = 1;

export function toBatchPoint(p: Position, routeId: string | null): BatchPoint {
  return {
    recordedAt: new Date(p.at).toISOString(),
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    level: p.level,
    ...(p.floorId ? { floorId: p.floorId } : {}),
    accuracyM: p.accuracyM,
    ...(routeId ? { routeId } : {}),
  };
}

/**
 * Buffers positions and uploads them every 10 s (and when it stops). Simulated
 * positions are not real movements and are never sent, unless VITE_LOG_SIMULATED_POSITIONS=true (demos).
 */
export class TrackLogger {
  private buffer: BatchPoint[] = [];
  private last: Position | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly send: (batch: { sessionId: string; points: BatchPoint[] }) => Promise<void>,
    private readonly logSimulated = import.meta.env.VITE_LOG_SIMULATED_POSITIONS === 'true',
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.flush(), FLUSH_MS);
  }

  add(p: Position, routeId: string | null): void {
    if (p.source === 'simulator' && !this.logSimulated) return;
    if (p.accuracyM > MAX_ACCURACY_M) return;
    if (this.last && this.last.level === p.level && Math.hypot(p.x - this.last.x, p.y - this.last.y) < MIN_MOVE_M && p.at - this.last.at < 5000) return;
    this.last = p;
    this.buffer.push(toBatchPoint(p, routeId));
    if (this.buffer.length >= MAX_BATCH) void this.flush();
  }

  get pending(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const points = this.buffer.splice(0, MAX_BATCH);
    await this.send({ sessionId: this.sessionId, points });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush().catch(() => undefined);
  }
}

/** Logs positions while sharing is active. onEnded: the server ended the session (409). */
export function useTrackLogger(position: Position | null, routeId: string | null, onEnded: () => void): void {
  const { data } = useSharingStatus();
  const qc = useQueryClient();
  const sessionId = activeSessionId(data);
  const logger = useRef<TrackLogger | null>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!sessionId) return undefined;
    const l = new TrackLogger(sessionId, async (batch) => {
      try {
        const res = await api.post<{ session: MobilitySessionStatus }>('/api/mobility/points', batch);
        if (res.data.session.state !== 'ACTIVE') {
          void qc.invalidateQueries({ queryKey: sharingKeys.session });
          endedRef.current();
        }
      } catch (err) {
        const code = errorCode(err);
        if (code === 'SESSION_ENDED' || code === 'SESSION_NOT_FOUND' || code === 'CONSENT_REQUIRED' || code === 'CONSENT_OUTDATED') {
          void qc.invalidateQueries({ queryKey: sharingKeys.session });
          endedRef.current();
        }
      }
    });
    l.start();
    logger.current = l;
    return () => {
      logger.current = null;
      void l.stop();
    };
  }, [sessionId, qc]);

  useEffect(() => {
    if (position) logger.current?.add(position, routeId);
  }, [position, routeId]);
}
