/**
 * Room detail (right panel on desktop, overlay drawer on tablet, bottom sheet on
 * phones): live status, today's timeline, accessibility, nearest step-free
 * facilities, nearby rooms, "Get directions" and "Save".
 */
import { Accessibility, Bookmark, BookmarkCheck, DoorOpen, Ear, GraduationCap, MapPin, Megaphone, Navigation, Shield, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCancelReservation, useCreateReservation, useRoom, useRooms } from '@/api/hooks';
import type { NearbyPoi, RoomDetail as RoomDetailDto } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { ElevatorIcon } from '@/features/map/icons';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { formatNumber, formatTime, formatTimeRange, formatUnit } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useSaved } from '@/stores/mapPrefs';
import type { Lang } from '@/stores/preferences';
import { statusLine } from './roomModel';

const linkButton = 'inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-control px-5 font-bold';

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Users }) {
  return (
    <div className="min-w-0 rounded-control border border-line p-3">
      <dt className="flex items-center gap-2 text-sm text-muted">
        <Icon aria-hidden className="size-5 shrink-0 text-primary" />
        {label}
      </dt>
      <dd className="mt-1 ps-7 text-base font-bold text-ink">{value}</dd>
    </div>
  );
}

function Nearest({ label, poi, icon, lang, onShow }: { label: string; poi: NearbyPoi | null; icon: typeof Users; lang: Lang; onShow?: (poi: NearbyPoi) => void }) {
  const { t } = useTranslation();
  const Icon = icon;
  if (!poi) return null;
  const where = poi.buildingCode ? `${poi.buildingCode} · ${floorLabel(poi.level, t)}` : t('map.outdoors');
  return (
    <li className="flex min-h-14 items-center gap-3">
      <Icon aria-hidden className="size-6 shrink-0 text-route-text" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-ink">{label}</p>
        <p className="text-sm text-muted">{t('detail.distance', { distance: formatUnit(Math.round(poi.routeDistanceM), 'meter', lang), floor: where })}</p>
      </div>
      {onShow ? (
        <Button variant="ghost" onClick={() => onShow(poi)}>
          {t('map.showOnMap')}
        </Button>
      ) : null}
    </li>
  );
}

function Timeline({ room, lang }: { room: RoomDetailDto; lang: Lang }) {
  const { t } = useTranslation();
  const now = Date.now();
  if (!room.schedule.length) return <p className="text-base text-muted">{t('detail.noSchedule')}</p>;
  return (
    <ol className="relative flex flex-col gap-2 border-s-2 border-line ps-4">
      {room.schedule.map((r) => {
        const current = new Date(r.startsAt).getTime() <= now && now < new Date(r.endsAt).getTime();
        const past = new Date(r.endsAt).getTime() <= now;
        return (
          <li key={r.id} aria-current={current ? 'time' : undefined} className={cn('relative rounded-control p-3', current ? 'bg-primary-50 hc:border-2 hc:border-white' : 'bg-surface-2', past && 'opacity-75')}>
            <span aria-hidden className={cn('absolute -start-[1.4rem] top-4 size-3 rounded-full border-2 border-card', current ? 'bg-primary' : 'bg-line-strong')} />
            <p className="flex flex-wrap items-center gap-2 text-base font-bold text-ink">
              <span className="tabular">{formatTimeRange(r.startsAt, r.endsAt, lang)}</span>
              {current ? <span className="rounded-full bg-primary px-2 text-sm text-on-primary">{t('detail.current')}</span> : null}
            </p>
            <p className="text-base text-ink">{r.title}</p>
            <p className="flex items-center gap-2 text-sm text-muted">
              <StatusBadge status={r.kind} size="sm" />
              {r.organizer}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function RoomDetail({ idOrCode, onShowPoi, onSelectRoom }: { idOrCode: string; onShowPoi?: (poi: NearbyPoi) => void; onSelectRoom?: (code: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const isDr = user?.role === 'TEACHER';
  const isClub = user?.role === 'CLUB';
  const createReservation = useCreateReservation();
  const cancelReservation = useCancelReservation();
  const [showOccupyForm, setShowOccupyForm] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [clubOrganizerName, setClubOrganizerName] = useState('');
  const [adminKind, setAdminKind] = useState<'ADMIN' | 'TEACHER' | 'CLUB'>('ADMIN');
  const [durationMinutes, setDurationMinutes] = useState(90);

  const { data: room, isLoading, isError, refetch } = useRoom(idOrCode);
  const saved = useSaved((s) => (room ? s.rooms.includes(room.code) : false));
  const toggleSaved = useSaved((s) => s.toggleRoom);
  const neighbours = useRooms({ buildingId: room?.building.id, floor: room?.floor.level }, !!room);

  const isMyClass =
    isDr &&
    room?.status.status === 'TEACHER' &&
    !!room.status.reservationId &&
    (!room.status.occupantName || room.status.occupantName === user?.displayName);

  const isMyClubEvent =
    isClub &&
    room?.status.status === 'CLUB' &&
    !!room.status.reservationId;

  const handleOccupy = async (e: FormEvent) => {
    e.preventDefault();
    if (!room) return;
    const now = new Date();
    const ends = new Date(now.getTime() + durationMinutes * 60_000);
    try {
      if (isAdmin) {
        const title = sessionTitle.trim() || (adminKind === 'ADMIN' ? 'Maintenance / Administration' : adminKind === 'TEACHER' ? 'Cours' : 'Activité');
        const organizer = clubOrganizerName.trim() || (adminKind === 'CLUB' ? 'Club' : user?.displayName || 'Administration');
        await createReservation.mutateAsync({
          roomId: room.id,
          kind: adminKind,
          title,
          organizer,
          startsAt: now.toISOString(),
          endsAt: ends.toISOString(),
        });
        toast.show(t('admin.occupySuccess', { code: room.code }), { tone: 'success' });
      } else if (isClub) {
        await createReservation.mutateAsync({
          roomId: room.id,
          kind: 'CLUB',
          title: sessionTitle.trim() || 'Activité Club',
          organizer: clubOrganizerName.trim() || user?.displayName || 'Club',
          startsAt: now.toISOString(),
          endsAt: ends.toISOString(),
        });
        toast.show(t('club.occupySuccess', { code: room.code }), { tone: 'success' });
      } else {
        await createReservation.mutateAsync({
          roomId: room.id,
          kind: 'TEACHER',
          title: sessionTitle.trim() || `Cours - ${user?.displayName ?? 'Dr'}`,
          startsAt: now.toISOString(),
          endsAt: ends.toISOString(),
        });
        toast.show(t('dr.occupySuccess', { code: room.code }), { tone: 'success' });
      }
      setShowOccupyForm(false);
      setSessionTitle('');
      setClubOrganizerName('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      toast.show(msg, { tone: 'error' });
    }
  };

  const handleRelease = async () => {
    if (!room?.status.reservationId) return;
    try {
      await cancelReservation.mutateAsync(room.status.reservationId);
      const toastKey = isAdmin ? 'admin.releaseSuccess' : isClub ? 'club.releaseSuccess' : 'dr.releaseSuccess';
      toast.show(t(toastKey, { code: room.code }), { tone: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      toast.show(msg, { tone: 'error' });
    }
  };

  if (isLoading) {
    return (
      <Skeleton.Group>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </Skeleton.Group>
    );
  }
  if (isError || !room) return <ErrorState title={t('detail.error')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />;

  const name = lang === 'ar' && room.nameAr ? room.nameAr : room.name;
  const nearby = (neighbours.data?.items ?? [])
    .filter((r) => r.id !== room.id)
    .map((r) => ({ r, d: Math.hypot(r.x - room.x, r.y - room.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const a11y = room.accessibility;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-lg font-bold text-ink">{name}</p>
        <p className="flex items-center gap-1 text-sm text-muted">
          <MapPin aria-hidden className="size-4 shrink-0" />
          {`${t(`roomType.${room.type}`)} · ${floorLabel(room.floor.level, t)} · ${lang === 'ar' ? room.building.nameAr : room.building.name}`}
        </p>
        <div aria-live="polite" className="flex flex-col gap-1">
          <StatusBadge status={room.status.status} label={room.status.label} />
          <p className="text-base text-ink">{statusLine(room.status, t, lang).split(' · ').slice(1).join(' · ')}</p>
          {room.status.occupantName ? <p className="text-sm text-muted">{t('detail.occupiedBy', { name: room.status.occupantName, title: room.status.title ?? '' })}</p> : null}
        </div>

        {/* Student Event Announcement if room is occupied by a Club */}
        {room.status.status === 'CLUB' ? (
          <div className="flex items-start gap-3 rounded-card border-2 border-club bg-club-bg/40 p-3.5 shadow-card">
            <Megaphone className="size-6 text-club shrink-0 mt-0.5 animate-pulse reduced:animate-none" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-club px-2.5 py-0.5 text-sm font-bold text-on-primary uppercase tracking-wider">
                  {t('club.eventNotice')}
                </span>
                {room.status.occupantName ? <span className="text-sm text-muted font-medium">{room.status.occupantName}</span> : null}
              </div>
              <p className="mt-1 text-base font-bold text-ink">
                {room.status.title || 'Activité Club'}
              </p>
              <p className="mt-0.5 text-sm text-ink/80">
                {t('club.studentsWelcome')}
              </p>
            </div>
          </div>
        ) : null}

        {/* Student Classroom Announcement for her assigned classroom */}
        {!isDr && !isClub && !isAdmin && room.code === 'A-104' ? (
          <div className="flex items-start gap-3 rounded-card border-2 border-primary/40 bg-primary-50/40 p-3.5 shadow-card">
            <GraduationCap className="size-6 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-on-primary">
                  {t('student.myClassBadge')}
                </span>
                <span className="text-sm text-muted font-medium">{t('student.yourCurrentClassroom')}</span>
              </div>
              <p className="mt-1 text-base font-bold text-ink">
                {t('student.subjectExample')}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label={t('detail.capacity')} value={formatNumber(room.capacity, lang)} icon={Users} />
        <Stat label={t('detail.stepFree')} value={a11y.stepFreeAccess ? t('detail.yes') : t('detail.no')} icon={Accessibility} />
        {a11y.doorClearanceCm ? <Stat label={t('detail.door')} value={formatUnit(a11y.doorClearanceCm, 'centimeter', lang)} icon={DoorOpen} /> : null}
        <Stat label={t('detail.wheelchairSpaces')} value={formatNumber(a11y.wheelchairSpaces, lang)} icon={Accessibility} />
      </dl>
      <ul className="flex flex-col gap-1 text-base text-ink">
        <li className="flex items-center gap-2">
          <Accessibility aria-hidden className={cn('size-5', a11y.wheelchairAccessible ? 'text-available' : 'text-danger')} />
          {a11y.wheelchairAccessible ? t('detail.wheelchairOk') : t('detail.wheelchairNo')}
        </li>
        {a11y.hearingLoop ? (
          <li className="flex items-center gap-2">
            <Ear aria-hidden className="size-5 text-primary" />
            {t('detail.hearingLoop')}
          </li>
        ) : null}
      </ul>

      {/* Admin controls: Occupy / Release Override */}
      {isAdmin ? (
        <div className="rounded-card border-2 border-primary/40 bg-surface-2 p-4 shadow-card">
          {room.status.status !== 'AVAILABLE' && !!room.status.reservationId ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-primary font-bold text-base">
                <Shield className="size-6 text-primary shrink-0" />
                <span>{t('admin.releasePrompt')}</span>
              </div>
              <div className="text-sm text-ink bg-card p-3 rounded-control border border-line space-y-1">
                <p className="font-semibold text-primary">{room.status.label}</p>
                {room.status.title ? <p>« {room.status.title} »</p> : null}
                {room.status.occupantName ? <p className="text-muted">Par : {room.status.occupantName}</p> : null}
                {room.status.until ? (
                  <p className="text-sm text-muted">Jusqu’à {formatTime(room.status.until, lang)}</p>
                ) : null}
              </div>
              <Button
                variant="danger"
                icon={DoorOpen}
                loading={cancelReservation.isPending}
                onClick={handleRelease}
                className="w-full font-bold"
              >
                {t('admin.releaseRoom')}
              </Button>
            </div>
          ) : room.status.status === 'AVAILABLE' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-primary font-bold">
                <Shield className="size-5 shrink-0" />
                <span>{t('admin.occupyRoom')}</span>
              </div>
              {!showOccupyForm ? (
                <Button
                  variant="primary"
                  icon={Shield}
                  className="bg-primary hover:bg-primary-800 text-on-primary font-bold"
                  onClick={() => setShowOccupyForm(true)}
                >
                  {t('admin.occupyRoom')}
                </Button>
              ) : (
                <form onSubmit={handleOccupy} className="flex flex-col gap-3 pt-1">
                  <Select
                    label={t('admin.kind')}
                    value={adminKind}
                    onChange={(e) => setAdminKind(e.target.value as 'ADMIN' | 'TEACHER' | 'CLUB')}
                  >
                    <option value="ADMIN">{t('admin.kindAdmin')}</option>
                    <option value="TEACHER">{t('admin.kindTeacher')}</option>
                    <option value="CLUB">{t('admin.kindClub')}</option>
                  </Select>
                  <Input
                    label={t('admin.titleLabel')}
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder="Ex: Maintenance réseau, Examen, etc."
                    required
                  />
                  <Input
                    label={t('admin.organizerLabel')}
                    value={clubOrganizerName}
                    onChange={(e) => setClubOrganizerName(e.target.value)}
                    placeholder={user?.displayName || 'Administration'}
                  />
                  <Select
                    label={t('dr.duration')}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>1h (60 min)</option>
                    <option value={90}>1h30 (90 min)</option>
                    <option value={120}>2h (120 min)</option>
                    <option value={240}>4h (Demi-journée)</option>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      loading={createReservation.isPending}
                      className="flex-1 bg-primary hover:bg-primary-800 text-on-primary font-bold"
                    >
                      {t('dr.confirmOccupy')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowOccupyForm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Dr controls: Occupy / Release */}
      {isDr ? (
        <div className="rounded-card border-2 border-available/30 bg-available-bg/20 p-4">
          {isMyClass ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-available font-bold text-base">
                <GraduationCap className="size-6 text-available shrink-0" />
                <span>{t('dr.myOccupiedClass')}</span>
              </div>
              <p className="text-sm text-ink">
                {room.status.title ? `« ${room.status.title} » · ` : ''}
                {room.status.until ? t('dr.occupiedUntil', { time: formatTime(room.status.until, lang) }) : ''}
              </p>
              <Button
                variant="danger"
                icon={DoorOpen}
                loading={cancelReservation.isPending}
                onClick={handleRelease}
                className="w-full"
              >
                {t('dr.releaseRoom')}
              </Button>
            </div>
          ) : room.status.status === 'AVAILABLE' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-available font-bold">
                <GraduationCap className="size-5 shrink-0" />
                <span>{t('dr.roomAvailableToOccupy')}</span>
              </div>
              <p className="text-sm text-muted">{t('dr.occupyPrompt')}</p>
              {!showOccupyForm ? (
                <Button
                  variant="primary"
                  icon={GraduationCap}
                  className="bg-available hover:bg-available/90 text-on-primary font-bold"
                  onClick={() => setShowOccupyForm(true)}
                >
                  {t('dr.occupyRoom')}
                </Button>
              ) : (
                <form onSubmit={handleOccupy} className="flex flex-col gap-3 pt-1">
                  <Input
                    label={t('dr.sessionTitle')}
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder={t('dr.sessionPlaceholder')}
                    required
                  />
                  <Select
                    label={t('dr.duration')}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  >
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1h (60 min)</option>
                    <option value={90}>1h30 (90 min - Séance standard)</option>
                    <option value={120}>2h (120 min)</option>
                    <option value={180}>3h (180 min)</option>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      loading={createReservation.isPending}
                      className="flex-1 bg-available hover:bg-available/90 text-on-primary font-bold"
                    >
                      {t('dr.confirmOccupy')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowOccupyForm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Club controls: Occupy / Release in Orange */}
      {isClub ? (
        <div className="rounded-card border-2 border-club/40 bg-club-bg/25 p-4 shadow-card">
          {isMyClubEvent ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-club font-bold text-base">
                <Users className="size-6 text-club shrink-0" />
                <span>{t('club.myOccupiedEvent')}</span>
              </div>
              <p className="text-sm text-ink">
                {room.status.title ? `« ${room.status.title} » · ` : ''}
                {room.status.until ? t('club.occupiedUntil', { time: formatTime(room.status.until, lang) }) : ''}
              </p>
              <Button
                variant="danger"
                icon={DoorOpen}
                loading={cancelReservation.isPending}
                onClick={handleRelease}
                className="w-full"
              >
                {t('club.releaseRoom')}
              </Button>
            </div>
          ) : room.status.status === 'AVAILABLE' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-club font-bold">
                <Users className="size-5 shrink-0" />
                <span>{t('club.roomAvailableToOccupy')}</span>
              </div>
              <p className="text-sm text-muted">{t('club.occupyPrompt')}</p>
              {!showOccupyForm ? (
                <Button
                  variant="primary"
                  icon={Users}
                  className="bg-club hover:bg-club/90 text-on-primary font-bold"
                  onClick={() => setShowOccupyForm(true)}
                >
                  {t('club.occupyRoom')}
                </Button>
              ) : (
                <form onSubmit={handleOccupy} className="flex flex-col gap-3 pt-1">
                  <Input
                    label={t('club.eventTitle')}
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                    placeholder={t('club.eventPlaceholder')}
                    required
                  />
                  <Input
                    label={t('club.clubName')}
                    value={clubOrganizerName}
                    onChange={(e) => setClubOrganizerName(e.target.value)}
                    placeholder={user?.displayName || 'Ex: Club Robotique'}
                  />
                  <Select
                    label={t('club.duration')}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>1h (60 min)</option>
                    <option value={90}>1h30 (90 min)</option>
                    <option value={120}>2h (120 min)</option>
                    <option value={180}>3h (180 min)</option>
                    <option value={240}>4h (240 min)</option>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      loading={createReservation.isPending}
                      className="flex-1 bg-club hover:bg-club/90 text-on-primary font-bold"
                    >
                      {t('club.confirmOccupy')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowOccupyForm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!isDr && !isClub && !isAdmin ? (
          <Link to={`/navigate?to=${encodeURIComponent(`room:${room.code}`)}`} className={`${linkButton} bg-primary text-on-primary hover:bg-primary-800`}>
            <Navigation aria-hidden className="size-5" />
            {t('detail.directions')}
          </Link>
        ) : null}
        <Button
          variant="secondary"
          icon={saved ? BookmarkCheck : Bookmark}
          aria-pressed={saved}
          className="flex-1 whitespace-nowrap"
          onClick={() => {
            const now = toggleSaved(room.code);
            toast.show(t(now ? 'detail.savedToast' : 'detail.unsavedToast', { code: room.code }), { tone: 'success' });
          }}
        >
          {saved ? t('detail.saved') : t('detail.save')}
        </Button>
      </div>

      <section aria-labelledby="detail-schedule">
        <h3 id="detail-schedule" className="mb-2 text-h3 text-ink">
          {t('detail.schedule')}
        </h3>
        <Timeline room={room} lang={lang} />
      </section>

      {room.nearest.elevator || room.nearest.accessibleToilet ? (
        <section aria-labelledby="detail-nearest">
          <h3 id="detail-nearest" className="mb-1 text-h3 text-ink">
            {t('detail.nearest')}
          </h3>
          <ul className="divide-y divide-line">
            <Nearest label={t('detail.elevator')} poi={room.nearest.elevator} icon={ElevatorIcon} lang={lang} {...(onShowPoi ? { onShow: onShowPoi } : {})} />
            <Nearest label={t('detail.toilet')} poi={room.nearest.accessibleToilet} icon={Accessibility} lang={lang} {...(onShowPoi ? { onShow: onShowPoi } : {})} />
          </ul>
        </section>
      ) : null}

      {nearby.length ? (
        <section aria-labelledby="detail-nearby">
          <h3 id="detail-nearby" className="mb-2 text-h3 text-ink">
            {t('detail.nearby')}
          </h3>
          <ul className="flex flex-col gap-2">
            {nearby.map(({ r }) => (
              <li key={r.id}>
                <button type="button" onClick={() => onSelectRoom?.(r.code)} className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-start hover:bg-surface-2">
                  <span>
                    <span className="block text-base font-bold text-ink">{r.code}</span>
                    <span className="block text-sm text-muted">{`${t(`roomType.${r.type}`)} · ${t('rooms.seats', { count: r.capacity })}`}</span>
                  </span>
                  <StatusBadge status={r.status.status} label={r.status.label} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
