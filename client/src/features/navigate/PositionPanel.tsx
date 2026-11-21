/**
 * Where am I: current source + accuracy, and the ways to set the position
 * (QR checkpoint, "I'm here", pick on the plan, satellite outdoors, demo simulator).
 */
import { Crosshair, LocateFixed, MapPinned, Pause, Play, QrCode, Satellite, Shuffle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnounce } from '@/a11y/Announcer';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { floorLabel } from '@/lib/floors';
import { formatUnit } from '@/lib/format';
import type { Lang } from '@/stores/preferences';
import { useResolvePosition } from './checkpoints';
import { useNav } from './navStore';
import { PlaceSearch, type Place } from './PlaceSearch';
import { geolocationStatus, SIM_SPEEDS, usePosition, watchGeolocation, type Position, type SimSpeed } from './position';
import { QrCheckpointDialog } from './QrCheckpointDialog';

export function describePosition(p: Position, t: (k: string, o?: Record<string, unknown>) => string, lang: Lang): string {
  const where = p.label ?? (p.floorId ? floorLabel(p.level, t) : t('guide.outdoors'));
  return `${where} · ${t(`guide.position.source.${p.source}`)} · ${t('guide.position.accuracy', { distance: formatUnit(p.accuracyM, 'meter', lang) })}`;
}

/** Shared "set my position" actions (also used by the planner's From field). */
export function usePositionActions() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const announce = useAnnounce();
  const set = usePosition((s) => s.set);
  const resolve = useResolvePosition();
  return async (place: Place, source: 'qr' | 'manual') => {
    const p = await resolve(place, source);
    if (!p) return;
    set(p);
    useNav.getState().setSim({ active: false });
    announce(t('guide.position.set', { place: place.label, accuracy: t('guide.position.accuracy', { distance: formatUnit(p.accuracyM, 'meter', lang) }) }));
  };
}

export function PositionPanel({ onPickOnMap, navigating, onWrongTurn }: { onPickOnMap: () => void; navigating: boolean; onWrongTurn?: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const position = usePosition((s) => s.position);
  const setPos = usePosition((s) => s.set);
  const sim = useNav((s) => s.sim);
  const setSim = useNav((s) => s.setSim);
  const setPlace = usePositionActions();
  const [qr, setQr] = useState(false);
  const [here, setHere] = useState(false);
  const [herePlace, setHerePlace] = useState<Place | null>(null);
  const [geoOn, setGeoOn] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const geo = geolocationStatus();

  useEffect(() => {
    if (!geoOn) return undefined;
    setSim({ active: false });
    return watchGeolocation(
      (p) => {
        setGeoError(false);
        setPos(p);
      },
      () => setGeoError(true),
    );
  }, [geoOn, setPos, setSim]);

  return (
    <section aria-labelledby="pos-title" className="flex flex-col gap-3">
      <h2 id="pos-title" className="text-h3 text-ink">
        {t('guide.position.title')}
      </h2>
      <p className="flex items-start gap-2 text-base text-ink" aria-live="polite">
        <LocateFixed aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>{position ? describePosition(position, t, lang) : t('guide.position.none')}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={QrCode} onClick={() => setQr(true)}>
          {t('guide.useQr')}
        </Button>
        <Button variant="secondary" icon={MapPinned} onClick={() => setHere(true)}>
          {t('guide.imHere')}
        </Button>
        <Button variant="secondary" icon={Crosshair} onClick={onPickOnMap}>
          {t('guide.pickOnMap')}
        </Button>
      </div>

      {geo === 'available' ? (
        <Toggle checked={geoOn} onChange={setGeoOn} label={t('guide.geo.use')} hint={geoError ? t('guide.geo.error') : t('guide.geo.outdoorsOnly')} />
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Satellite aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(geo === 'unsupported' ? 'guide.geo.unsupported' : 'guide.geo.notConfigured')}
        </p>
      )}

      {navigating ? (
        <div className="flex flex-col gap-2 rounded-card border border-line p-3">
          <Toggle checked={sim.active} onChange={(v) => setSim({ active: v, playing: true })} label={t('guide.sim.title')} hint={t('guide.sim.note')} />
          {sim.active ? (
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="secondary" icon={sim.playing ? Pause : Play} onClick={() => setSim({ playing: !sim.playing })} aria-pressed={!sim.playing}>
                {sim.playing ? t('guide.sim.pause') : t('guide.sim.play')}
              </Button>
              <Select label={t('guide.sim.speed')} value={String(sim.speed)} onChange={(e) => setSim({ speed: Number(e.target.value) as SimSpeed })} className="w-28">
                {SIM_SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {t('guide.sim.speedValue', { n: s })}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" icon={Shuffle} onClick={onWrongTurn}>
                {t('guide.sim.wrongTurn')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <QrCheckpointDialog
        open={qr}
        onClose={() => setQr(false)}
        onPlace={(place) => {
          setQr(false);
          void setPlace(place, 'qr');
        }}
      />
      <Dialog
        open={here}
        onClose={() => setHere(false)}
        title={t('guide.imHere')}
        description={t('guide.imHereText')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setHere(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              icon={MapPinned}
              disabled={!herePlace}
              onClick={() => {
                if (herePlace) void setPlace(herePlace, 'manual');
                setHere(false);
              }}
            >
              {t('guide.imHereConfirm')}
            </Button>
          </>
        }
      >
        <PlaceSearch label={t('guide.imHereLabel')} value={herePlace} onChange={setHerePlace} autoFocus />
      </Dialog>
    </section>
  );
}
