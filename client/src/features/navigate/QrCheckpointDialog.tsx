/**
 * QR checkpoint: the camera scans the code by a door or an elevator where the browser
 * supports it (BarcodeDetector); the code printed under it (or the room code on the
 * door sign) can always be typed instead.
 */
import { QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchIndex } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import type { Lang } from '@/stores/preferences';
import { placeOfCheckpoint } from './checkpoints';
import type { Place } from './PlaceSearch';
import { parseCheckpoint } from './position';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const detectorCtor = (): DetectorCtor | null => (typeof window !== 'undefined' && 'BarcodeDetector' in window ? ((window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector ?? null) : null);

export function QrCheckpointDialog({ open, onClose, onPlace }: { open: boolean; onClose: () => void; onPlace: (place: Place) => void }) {
  const { t, i18n } = useTranslation();
  const index = useSearchIndex();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('off');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accept = (raw: string): boolean => {
    const cp = parseCheckpoint(raw);
    if (!cp) {
      setError(t('guide.qr.invalid'));
      return false;
    }
    const place = index.data ? placeOfCheckpoint(cp, index.data, i18n.language as Lang) : null;
    if (!place) {
      setError(t('guide.qr.unknown', { code: cp.id }));
      return false;
    }
    setError(null);
    onPlace(place);
    return true;
  };
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!open || !Ctor || !navigator.mediaDevices?.getUserMedia) {
      setCamera('off');
      return undefined;
    }
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    setCamera('starting');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        setCamera('on');
        const detector = new Ctor({ formats: ['qr_code'] });
        const loop = async () => {
          if (cancelled) return;
          const codes = await detector.detect(v).catch(() => []);
          if (codes[0] && acceptRef.current(codes[0].rawValue)) return;
          timer = window.setTimeout(() => void loop(), 300);
        };
        void loop();
      })
      .catch(() => setCamera('off'));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('guide.qr.title')}
      description={camera === 'off' ? t('guide.qr.noCamera') : t('guide.qr.text')}
      initialFocus={input}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button icon={QrCode} onClick={() => accept(code)} disabled={!code.trim()}>
            {t('guide.qr.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {camera !== 'off' ? (
          <div className="overflow-hidden rounded-card border border-line bg-black">
            <video ref={video} className="aspect-video w-full object-cover" muted playsInline aria-label={t('guide.qr.camera')} />
            {camera === 'starting' ? <p className="p-3 text-sm text-white">{t('guide.qr.starting')}</p> : null}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            accept(code);
          }}
        >
          <Input
            ref={input}
            label={t('guide.qr.code')}
            hint={t('guide.qr.codeHint')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
            autoComplete="off"
          />
        </form>
      </div>
    </Dialog>
  );
}
