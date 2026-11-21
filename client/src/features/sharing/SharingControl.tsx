/**
 * Location sharing switch. Turning it on shows the policy (from the server, in the
 * interface language) and asks for consent once per policy version.
 */
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Toggle } from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/stores/auth';
import { activeSessionId, useConsent, useSharingStatus, useStartSharing, useStopSharing } from './sharing';

function minutes(sec: number): number {
  return Math.max(1, Math.round(sec / 60));
}

export function SharingControl() {
  const { t } = useTranslation();
  const toast = useToast();
  const signedIn = useAuth((s) => s.status === 'authenticated');
  const consent = useConsent();
  const status = useSharingStatus();
  const start = useStartSharing();
  const stop = useStopSharing();
  const [asking, setAsking] = useState(false);
  const sessionId = activeSessionId(status.data);
  const on = !!sessionId;

  if (!signedIn) {
    return (
      <p className="text-base text-muted">
        <Link to="/login" className="font-bold text-primary underline">
          {t('sharing.signIn')}
        </Link>
      </p>
    );
  }

  const doStart = (grantConsent: boolean) => {
    const policyVersion = consent.data?.currentPolicy.version;
    if (!policyVersion) return;
    start.mutate(
      { policyVersion, grantConsent },
      {
        onSuccess: () => {
          setAsking(false);
          toast.show(t('sharing.started'), { tone: 'success' });
        },
        onError: () => toast.show(t('sharing.failed'), { tone: 'error' }),
      },
    );
  };

  const onChange = (next: boolean) => {
    if (next) {
      if (consent.data?.upToDate) doStart(false);
      else setAsking(true);
    } else if (sessionId) {
      stop.mutate(sessionId, { onSuccess: () => toast.show(t('sharing.stopped')) });
    }
  };

  const session = status.data?.session;
  const hint = on && session ? (session.reminder ?? t('sharing.remaining', { n: minutes(session.remainingSec) })) : status.data?.state === 'ENDED' && status.data.message ? status.data.message : t('sharing.hint');

  return (
    <>
      <Toggle checked={on} onChange={onChange} label={t('sharing.toggle')} hint={hint} disabled={start.isPending || stop.isPending || consent.isLoading} />
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t('sharing.consentTitle')}
        description={t('sharing.consentIntro')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t('sharing.cancel')}
            </Button>
            <Button icon={ShieldCheck} loading={start.isPending} onClick={() => doStart(true)}>
              {t('sharing.agree')}
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-2 ps-5 text-base text-ink">
          {consent.data?.currentPolicy.summary.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </Dialog>
    </>
  );
}
