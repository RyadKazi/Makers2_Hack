/**
 * "Report a problem here": blocked / too steep / hard to navigate → DifficultyEvent at the
 * current position, tagged with the route. Reports go through the anonymous sharing
 * session; with sharing off, a one-off session is opened for the report and closed again.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Flag, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { MobilityEventReport, MobilitySessionStatus } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { RadioGroup } from '@/components/ui/Choice';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { activeSessionId, sharingKeys, useConsent, useSharingStatus } from '@/features/sharing/sharing';
import { useIds } from '@/lib/hooks';
import { useAuth } from '@/stores/auth';
import { usePosition } from './position';

const TYPES = ['BLOCKED', 'TOO_STEEP', 'HARD_TO_NAVIGATE'] as const;
type ReportType = (typeof TYPES)[number];

export function ReportProblem({ routeId, className }: { routeId: string | null; className?: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const ids = useIds('note', 'noteHint');
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>('BLOCKED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const signedIn = useAuth((s) => s.status === 'authenticated');
  const position = usePosition((s) => s.position);
  const status = useSharingStatus();
  const consent = useConsent();
  const sessionId = activeSessionId(status.data);

  const send = async () => {
    if (!position) return;
    setBusy(true);
    let oneOff: string | null = null;
    try {
      let sid = sessionId;
      if (!sid) {
        if (!consent.data?.upToDate) await api.post('/api/mobility/consent', { policyVersion: consent.data?.currentPolicy.version, lang: i18n.language });
        sid = (await api.post<MobilitySessionStatus>('/api/mobility/sessions', { lang: i18n.language })).data.session?.id ?? null;
        oneOff = sid;
      }
      if (!sid) throw new Error('no session');
      const body: MobilityEventReport = {
        sessionId: sid,
        type,
        x: position.x,
        y: position.y,
        level: position.level,
        ...(position.floorId ? { floorId: position.floorId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(routeId ? { routeId } : {}),
      };
      await api.post('/api/mobility/events', body);
      toast.show(t('guide.report.sent'), { tone: 'success' });
      setOpen(false);
      setNote('');
    } catch {
      toast.show(t('guide.report.failed'), { tone: 'error' });
    } finally {
      if (oneOff) await api.post(`/api/mobility/sessions/${oneOff}/stop`).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: sharingKeys.session });
      void qc.invalidateQueries({ queryKey: sharingKeys.consent });
      setBusy(false);
    }
  };

  const needsOneOff = signedIn && !sessionId;

  return (
    <>
      <Button variant="secondary" icon={Flag} fullWidth className={className} onClick={() => setOpen(true)}>
        {t('guide.report.open')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('guide.report.title')}
        description={t('guide.report.text')}
        footer={
          signedIn && position ? (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button icon={Send} loading={busy} onClick={() => void send()}>
                {needsOneOff ? t('guide.report.shareAndSend') : t('guide.report.send')}
              </Button>
            </>
          ) : undefined
        }
      >
        {!signedIn ? (
          <p className="text-base">
            <Link to="/login" className="font-bold text-primary underline">
              {t('guide.report.signIn')}
            </Link>
          </p>
        ) : !position ? (
          <p className="text-base text-ink">{t('guide.report.needPosition')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <RadioGroup legend={t('guide.report.type')} name="report-type" value={type} onChange={setType} options={TYPES.map((v) => ({ value: v, label: t(`guide.report.types.${v}`) }))} />
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.note} className="text-sm font-bold text-ink">
                {t('guide.report.note')}
              </label>
              <textarea
                id={ids.note}
                aria-describedby={ids.noteHint}
                maxLength={280}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-12 rounded-control border-control bg-card px-4 py-3 text-base text-ink"
              />
              <p id={ids.noteHint} className="text-sm text-muted">
                {t('guide.report.noteHint')}
              </p>
            </div>
            {needsOneOff ? (
              <div className="rounded-control bg-surface-2 p-3 text-sm text-ink">
                <p className="font-bold">{t('guide.report.needsSharing')}</p>
                {!consent.data?.upToDate ? (
                  <ul className="mt-2 list-disc ps-5">
                    {consent.data?.currentPolicy.summary.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
