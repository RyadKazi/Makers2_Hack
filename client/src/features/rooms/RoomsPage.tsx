/**
 * Find a room: filters (status, building, floor, capacity, step-free) kept in the
 * URL, table (desktop) or cards, sorting, pagination, live statuses, details in
 * the side panel / bottom sheet. Results update as filters change (no "Apply"
 * step) and the count is announced politely.
 */
import { Accessibility, Bookmark, BookmarkCheck, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, DoorOpen, Footprints, GraduationCap, LayoutGrid, Megaphone, Navigation, Shield, SlidersHorizontal, Table2, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useBuildings, useRooms } from '@/api/hooks';
import type { RoomSummary } from '@/api/types';
import { BottomSheet, type Snap } from '@/components/ui/BottomSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RadioGroup } from '@/components/ui/Choice';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { Page } from '@/components/shell/Page';
import { useRightPanel } from '@/components/shell/RightPanel';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { formatNumber } from '@/lib/format';
import { useTier } from '@/lib/hooks';
import { useLiveFloors } from '@/realtime/liveRooms';
import { useAuth } from '@/stores/auth';
import { useSaved } from '@/stores/mapPrefs';
import type { Lang } from '@/stores/preferences';
import { RoomDetail } from './RoomDetail';
import { filterByCapacity, freeText, paginate, SORT_KEYS, sortRooms, STATUS_FILTERS, statusParam, type SortKey, type StatusFilter } from './roomModel';

const PAGE_SIZE = 12;
const int = (v: string | null): number | undefined => (v && /^\d+$/.test(v) ? Number(v) : undefined);

function useFilters() {
  const [params, setParams] = useSearchParams();
  const f = {
    status: (STATUS_FILTERS.includes(params.get('status') as StatusFilter) ? params.get('status') : 'all') as StatusFilter,
    building: params.get('building') ?? '',
    floor: params.get('floor') ?? '',
    min: int(params.get('min')),
    max: int(params.get('max')),
    stepFree: params.get('stepFree') === '1',
    sort: (SORT_KEYS.includes(params.get('sort') as SortKey) ? params.get('sort') : 'code') as SortKey,
    page: int(params.get('page')) ?? 1,
    view: params.get('view') === 'cards' ? 'cards' : 'table',
  };
  const set = (patch: Record<string, string | number | boolean | undefined>, keepPage = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || v === false || (k === 'status' && v === 'all')) next.delete(k);
          else next.set(k, v === true ? '1' : String(v));
        }
        if (!keepPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const reset = () => setParams(new URLSearchParams(f.view === 'cards' ? { view: 'cards' } : {}), { replace: true });
  return { f, set, reset };
}

function Filters({ f, set, reset }: ReturnType<typeof useFilters>) {
  const { t, i18n } = useTranslation();
  const buildings = useBuildings();
  const levels = [...new Set((buildings.data?.items ?? []).filter((b) => !f.building || b.id === f.building).flatMap((b) => b.floors.map((fl) => fl.level)))].sort();
  return (
    <div className="flex flex-col gap-5">
      <RadioGroup<StatusFilter>
        legend={t('rooms.status')}
        name="status"
        value={f.status}
        onChange={(v) => set({ status: v })}
        options={STATUS_FILTERS.map((s) => ({ value: s, label: t(`rooms.statusFilter.${s}`) }))}
      />
      <Select label={t('rooms.building')} value={f.building} onChange={(e) => set({ building: e.target.value, floor: undefined })}>
        <option value="">{t('rooms.allBuildings')}</option>
        {buildings.data?.items.map((b) => (
          <option key={b.id} value={b.id}>
            {i18n.language === 'ar' ? b.nameAr : b.name}
          </option>
        ))}
      </Select>
      <Select label={t('rooms.floor')} value={f.floor} onChange={(e) => set({ floor: e.target.value })}>
        <option value="">{t('rooms.allFloors')}</option>
        {levels.map((l) => (
          <option key={l} value={l}>
            {floorLabel(l, t)}
          </option>
        ))}
      </Select>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-bold text-ink">{t('rooms.capacity')}</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input label={t('rooms.min')} type="number" inputMode="numeric" min={1} value={f.min ?? ''} onChange={(e) => set({ min: e.target.value })} />
          <Input label={t('rooms.max')} type="number" inputMode="numeric" min={1} value={f.max ?? ''} onChange={(e) => set({ max: e.target.value })} />
        </div>
      </fieldset>
      <Toggle checked={f.stepFree} onChange={(v) => set({ stepFree: v })} label={t('rooms.stepFree')} className="-mx-3" />
      <Button variant="ghost" onClick={reset}>
        {t('rooms.reset')}
      </Button>
    </div>
  );
}

function SortHeader({ k, label, f, set }: { k: SortKey; label: string } & Pick<ReturnType<typeof useFilters>, 'f' | 'set'>) {
  const active = f.sort === k;
  const Icon = active ? (k === 'capacity' ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={active ? (k === 'capacity' ? 'descending' : 'ascending') : 'none'} className="px-3 py-2 text-start">
      <button type="button" onClick={() => set({ sort: k })} className="inline-flex min-h-12 items-center gap-2 rounded-control px-2 text-sm font-bold text-ink hover:bg-surface-2">
        {label}
        <Icon aria-hidden className={cn('size-4', active ? 'text-primary' : 'text-muted')} />
      </button>
    </th>
  );
}

function SaveToggle({ code }: { code: string }) {
  const { t } = useTranslation();
  const saved = useSaved((s) => s.rooms.includes(code));
  const toggle = useSaved((s) => s.toggleRoom);
  return <IconButton icon={saved ? BookmarkCheck : Bookmark} label={`${saved ? t('detail.saved') : t('detail.save')} ${code}`} aria-pressed={saved} onClick={() => toggle(code)} className={saved ? 'text-primary' : ''} />;
}

function Access({ room }: { room: RoomSummary }) {
  const { t } = useTranslation();
  return room.stepFreeAccess ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-available">
      <Accessibility aria-hidden className="size-5" />
      {t('rooms.stepFreeYes')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-warning">
      <Footprints aria-hidden className="size-5" />
      {t('rooms.stepFreeNo')}
    </span>
  );
}

export function RoomsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const isDr = user?.role === 'TEACHER';
  const isClub = user?.role === 'CLUB';
  const isStudent = user?.role === 'STUDENT' || (!isAdmin && !isDr && !isClub);
  const tier = useTier();
  const panel = useRightPanel();
  const filters = useFilters();
  const { f, set } = filters;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [snap, setSnap] = useState<Snap>('full');
  const [params] = useSearchParams();

  const { data, isLoading, isError, refetch } = useRooms({
    status: statusParam(f.status),
    buildingId: f.building || undefined,
    floor: f.floor === '' ? undefined : Number(f.floor),
    minCapacity: f.min,
    stepFree: f.stepFree ? true : undefined,
  });

  const all = useMemo(() => sortRooms(filterByCapacity(data?.items ?? [], f.min, f.max), f.sort), [data, f.min, f.max, f.sort]);
  const myClassRoom = useMemo(() => all.find((r) => r.code === 'A-104'), [all]);
  const clubRooms = useMemo(() => all.filter((r) => r.status.status === 'CLUB'), [all]);

  const { items, page, pages } = paginate(all, f.page, PAGE_SIZE);
  const view = tier === 'desktop' ? f.view : 'cards';
  useLiveFloors(items.map((r) => r.floor.id));

  const open = (r: RoomSummary) => panel.open({ title: r.code, body: <RoomDetail key={r.code} idOrCode={r.code} onSelectRoom={(code) => openCode(code)} /> });
  const openCode = (code: string) => panel.open({ title: code, body: <RoomDetail key={code} idOrCode={code} onSelectRoom={(c) => openCode(c)} /> });

  // Deep link from the command palette: /rooms?code=A-104
  const deepLinked = useRef(false);
  useEffect(() => {
    const code = params.get('code');
    if (code && !deepLinked.current) {
      deepLinked.current = true;
      openCode(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const where = (r: RoomSummary) => t('map.levelName', { building: lang === 'ar' ? r.building.nameAr : r.building.name, floor: floorLabel(r.floor.level, t) });
  const count = t('rooms.found', { count: all.length });

  let results: ReactNode;
  if (isError) results = <ErrorState title={t('rooms.errorTitle')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />;
  else if (isLoading)
    results = (
      <Skeleton.Group>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </Skeleton.Group>
    );
  else if (all.length === 0)
    results = (
      <EmptyState
        icon={DoorOpen}
        title={t('rooms.emptyTitle')}
        text={t('rooms.emptyText')}
        action={
          <Button variant="secondary" onClick={filters.reset}>
            {t('rooms.reset')}
          </Button>
        }
      />
    );
  else if (view === 'table')
    results = (
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">{`${count}. ${t('rooms.sortedBy', { key: t(`rooms.sort.${f.sort}`) })}`}</caption>
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <SortHeader k="code" label={t('rooms.col.room')} f={f} set={set} />
              <th scope="col" className="px-3 py-2 text-start text-sm font-bold text-ink">
                {t('rooms.col.where')}
              </th>
              <SortHeader k="status" label={t('rooms.col.status')} f={f} set={set} />
              <SortHeader k="free" label={t('rooms.col.free')} f={f} set={set} />
              <SortHeader k="capacity" label={t('rooms.col.capacity')} f={f} set={set} />
              <th scope="col" className="px-3 py-2 text-start text-sm font-bold text-ink">
                {t('rooms.col.access')}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t('rooms.details')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const isMyClass = isDr && r.status.status === 'TEACHER' && (!r.status.occupantName || r.status.occupantName === user?.displayName || user?.role === 'ADMIN');
              const isMyClub = isClub && r.status.status === 'CLUB' && !!r.status.reservationId;
              const isClubEvent = r.status.status === 'CLUB';
              const isStudentClass = isStudent && r.code === 'A-104';
              return (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b border-line last:border-0 hover:bg-surface-2 transition-colors',
                    isMyClass && 'bg-available-bg/25',
                    isMyClub && 'bg-club-bg/25',
                    !isMyClub && isClubEvent && 'bg-club-bg/10',
                    isStudentClass && 'bg-primary-50/20',
                  )}
                >
                  <th scope="row" className="px-3 py-3 text-start">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="block text-base font-bold text-ink">{r.code}</span>
                      {isAdmin && r.status.status === 'ADMIN' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-occupied px-2 py-0.5 text-sm font-bold text-on-primary">
                          <Shield className="size-3" />
                          Admin
                        </span>
                      ) : null}
                      {isMyClass ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-available px-2 py-0.5 text-sm font-bold text-on-primary">
                          <GraduationCap className="size-3" />
                          {t('dr.myClass')}
                        </span>
                      ) : null}
                      {isMyClub ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-club px-2 py-0.5 text-sm font-bold text-on-primary">
                          <Users className="size-3" />
                          {t('club.myClub')}
                        </span>
                      ) : null}
                      {!isMyClub && isClubEvent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-club/15 text-club border border-club/30 px-2 py-0.5 text-sm font-bold">
                          <Megaphone className="size-3" />
                          {r.status.title || t('club.eventNotice')}
                        </span>
                      ) : null}
                      {isStudentClass ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-sm font-bold text-on-primary shadow-card">
                          <GraduationCap className="size-3" />
                          {t('student.myClassBadge')}
                        </span>
                      ) : null}
                    </div>
                    <span className="block text-sm font-normal text-muted">{lang === 'ar' && r.nameAr ? r.nameAr : r.name}</span>
                  </th>
                  <td className="px-3 py-3 text-base text-ink">
                    <span className="block whitespace-nowrap">{lang === 'ar' ? r.building.nameAr : r.building.name}</span>
                    <span className="block whitespace-nowrap text-sm text-muted">{floorLabel(r.floor.level, t)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      status={r.status.status}
                      label={
                        isMyClass
                          ? `${t('status.TEACHER')} (${t('dr.myClass')})`
                          : isMyClub
                          ? `${t('status.CLUB')} (${t('club.myClub')})`
                          : r.status.label
                      }
                      size="sm"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-base text-ink">{freeText(r.status, t, lang)}</td>
                  <td className="px-3 py-3 text-base text-ink tabular">{formatNumber(r.capacity, lang)}</td>
                  <td className="px-3 py-3">
                    <Access room={r} />
                  </td>
                  <td className="px-3 py-3 text-end">
                    <Button
                      variant={
                        isAdmin
                          ? r.status.status === 'AVAILABLE'
                            ? 'primary'
                            : 'secondary'
                          : (isDr || isClub) && r.status.status === 'AVAILABLE'
                          ? 'primary'
                          : 'secondary'
                      }
                      className={cn(
                        isAdmin && r.status.status === 'AVAILABLE' && 'bg-primary hover:bg-primary-800 text-on-primary font-bold',
                        isAdmin && r.status.status !== 'AVAILABLE' && 'border-danger/40 text-danger hover:bg-danger/10 font-bold',
                        isDr && r.status.status === 'AVAILABLE' && 'bg-available hover:bg-available/90 text-on-primary font-bold',
                        isClub && r.status.status === 'AVAILABLE' && 'bg-club hover:bg-club/90 text-on-primary font-bold',
                      )}
                      onClick={() => open(r)}
                      aria-label={t('rooms.detailsOf', { code: r.code })}
                    >
                      {isAdmin
                        ? r.status.status === 'AVAILABLE'
                          ? t('admin.quickOccupy')
                          : t('admin.quickRelease')
                        : isDr && r.status.status === 'AVAILABLE'
                        ? t('dr.occupyRoom')
                        : isClub && r.status.status === 'AVAILABLE'
                        ? t('club.occupyRoom')
                        : t('rooms.details')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  else
    results = (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4">
        {items.map((r) => {
          const isMyClass = isDr && r.status.status === 'TEACHER' && (!r.status.occupantName || r.status.occupantName === user?.displayName || user?.role === 'ADMIN');
          const isMyClub = isClub && r.status.status === 'CLUB' && !!r.status.reservationId;
          const isClubEvent = r.status.status === 'CLUB';
          const isStudentClass = isStudent && r.code === 'A-104';
          return (
            <li key={r.id}>
              <Card
                as="article"
                className={cn(
                  'card-interactive flex h-full flex-col gap-3 rounded-card p-5 border border-line/60 bg-card shadow-card transition-all',
                  isMyClass && 'border-2 border-available bg-available-bg/15 shadow-card',
                  isMyClub && 'border-2 border-club bg-club-bg/15 shadow-card',
                  !isMyClub && isClubEvent && 'border-club/40 bg-club-bg/10',
                  isStudentClass && 'border-2 border-primary bg-primary-50/20 shadow-float ring-2 ring-primary/20',
                )}
                aria-labelledby={`room-${r.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-12 shrink-0 items-center justify-center rounded-card bg-surface-2 text-primary hc:border-2 hc:border-white transition-transform group-hover:scale-105',
                      isMyClass && 'bg-available text-on-primary',
                      isMyClub && 'bg-club text-on-primary',
                      !isMyClub && isClubEvent && 'bg-club/15 text-club',
                      isStudentClass && 'bg-primary text-on-primary',
                    )}
                  >
                    {isMyClass ? (
                      <GraduationCap className="size-6" />
                    ) : isMyClub ? (
                      <Users className="size-6" />
                    ) : isClubEvent ? (
                      <Megaphone className="size-6" />
                    ) : (
                      <DoorOpen className="size-6" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id={`room-${r.id}`} className="text-h3 text-ink font-black">
                        {r.code}
                      </h2>
                      {isMyClass ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-available px-2 py-0.5 text-sm font-bold text-on-primary">
                          <GraduationCap className="size-3" />
                          {t('dr.myClass')}
                        </span>
                      ) : null}
                      {isMyClub ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-club px-2 py-0.5 text-sm font-bold text-on-primary">
                          <Users className="size-3" />
                          {t('club.myClub')}
                        </span>
                      ) : null}
                      {isStudentClass ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-on-primary shadow-card">
                          <GraduationCap className="size-3" />
                          {t('student.myClassBadge')}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted">{where(r)}</p>
                  </div>
                  <SaveToggle code={r.code} />
                </div>
                <StatusBadge
                  status={r.status.status}
                  label={
                    isMyClass
                      ? `${t('status.TEACHER')} (${t('dr.myClass')})`
                      : isMyClub
                      ? `${t('status.CLUB')} (${t('club.myClub')})`
                      : r.status.label
                  }
                />
                {!isMyClub && isClubEvent ? (
                  <div className="flex items-center gap-2 rounded-control border border-club/30 bg-club-bg/30 p-2.5 text-sm font-bold text-ink">
                    <Megaphone className="size-4 shrink-0 text-club" />
                    <span className="truncate">📢 {r.status.title || t('club.eventNotice')}</span>
                  </div>
                ) : null}
                <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/60 pt-3 text-base text-ink">
                  <div className="flex items-center gap-1.5">
                    <dt>
                      <Users aria-hidden className="size-5 text-muted" />
                      <span className="sr-only">{t('rooms.col.capacity')}</span>
                    </dt>
                    <dd className="tabular">{formatNumber(r.capacity, lang)}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">{t('rooms.col.free')}</dt>
                    <dd>{freeText(r.status, t, lang)}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('rooms.col.access')}</dt>
                    <dd>
                      <Access room={r} />
                    </dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-center gap-2 pt-2 border-t border-line/40">
                  <Link
                    to={`/navigate?to=room:${encodeURIComponent(r.code)}`}
                    title={t('student.goToClassroomRoute')}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-card bg-surface-2 text-ink hover:bg-primary hover:text-on-primary transition-all duration-200"
                  >
                    <Navigation className="size-4" />
                  </Link>
                  <Button
                    variant={
                      isAdmin
                        ? r.status.status === 'AVAILABLE'
                          ? 'primary'
                          : 'secondary'
                        : (isDr || isClub) && r.status.status === 'AVAILABLE'
                        ? 'primary'
                        : 'secondary'
                    }
                    className={cn(
                      'flex-1 text-sm font-bold min-h-12 rounded-card',
                      isAdmin && r.status.status === 'AVAILABLE' && 'bg-primary hover:bg-primary-800 text-on-primary',
                      isAdmin && r.status.status !== 'AVAILABLE' && 'border-danger/40 text-danger hover:bg-danger/10',
                      isDr && r.status.status === 'AVAILABLE' && 'bg-available hover:bg-available/90 text-on-primary',
                      isClub && r.status.status === 'AVAILABLE' && 'bg-club hover:bg-club/90 text-on-primary',
                    )}
                    onClick={() => open(r)}
                    aria-label={t('rooms.detailsOf', { code: r.code })}
                  >
                    {isAdmin
                      ? r.status.status === 'AVAILABLE'
                        ? t('admin.quickOccupy')
                        : t('admin.quickRelease')
                      : isDr && r.status.status === 'AVAILABLE'
                      ? t('dr.occupyRoom')
                      : isClub && r.status.status === 'AVAILABLE'
                      ? t('club.occupyRoom')
                      : t('rooms.details')}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    );

  return (
    <Page title={t('page.rooms')} description={t('rooms.subtitle')} className="max-w-none">
      {/* Student shortcuts are useful only when there is an immediate next action. */}
      {isStudent && (
        <div className="mb-6 flex flex-col gap-4">
          {/* My Classroom Banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border-2 border-primary/30 bg-primary-50/30 p-5 shadow-card">
            <div className="flex items-start gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-card bg-primary text-on-primary shadow-card">
                <GraduationCap className="size-8" />
              </span>
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-on-primary">
                    {t('student.classroomBannerTitle')}
                  </span>
                  <span className="text-sm font-bold text-primary">Salle A-104</span>
                  {myClassRoom ? (
                    <StatusBadge status={myClassRoom.status.status} label={myClassRoom.status.label} size="sm" />
                  ) : null}
                </div>
                <p className="mt-1 text-lg font-bold text-ink">
                  {t('student.subjectExample')}
                </p>
                <p className="text-sm text-muted">
                  Bâtiment A · Rez-de-chaussée · 08h30 - 10h00
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/navigate?to=room:A-104"
                className="inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-on-primary hover:bg-primary-800 shadow-card"
              >
                <Navigation className="size-4" />
                {t('student.goToClassroomRoute')}
              </Link>
              <Button
                variant="secondary"
                onClick={() => openCode('A-104')}
              >
                {t('student.viewRoomDetails')}
              </Button>
            </div>
          </div>

          {/* Active Club Events Spotlight */}
          {clubRooms.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border-2 border-club/30 bg-club-bg/20 p-5 shadow-card">
              <div className="flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-club text-on-primary shadow-card">
                  <Megaphone className="size-6 animate-pulse" />
                </span>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-club px-2.5 py-0.5 text-sm font-bold text-on-primary">
                      {t('student.campusClubEvents')}
                    </span>
                    <span className="text-sm text-muted font-bold">
                      {t('student.activeEventsCount', { count: clubRooms.length })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {clubRooms.map((cr) => (
                      <span key={cr.id} className="text-sm font-bold text-ink">
                        « {cr.status.title || 'Activité Club'} » en Salle {cr.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="bg-club hover:bg-club/90 text-on-primary font-bold"
                  onClick={() => clubRooms[0] && open(clubRooms[0])}
                >
                  {t('student.joinEvent')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 desk:grid-cols-[18rem_1fr]">
        {tier === 'desktop' ? (
          <Card as="section" aria-labelledby="filters-title" className="h-fit desk:sticky desk:top-20">
            <h2 id="filters-title" className="mb-4 text-h3 text-ink">
              {t('rooms.filters')}
            </h2>
            <Filters {...filters} />
          </Card>
        ) : null}

        <section aria-labelledby="results-title" className="flex min-w-0 flex-col gap-4">
          <h2 id="results-title" className="sr-only">
            {t('rooms.results')}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            {tier !== 'desktop' ? (
              <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setSheetOpen(true)}>
                {t('rooms.filters')}
              </Button>
            ) : (
              <Tabs
                idBase="rooms-view"
                label={t('rooms.display')}
                value={f.view as 'table' | 'cards'}
                onChange={(v) => set({ view: v === 'cards' ? 'cards' : undefined }, true)}
                items={[
                  { value: 'table', label: t('rooms.table'), icon: Table2 },
                  { value: 'cards', label: t('rooms.cards'), icon: LayoutGrid },
                ]}
              />
            )}
            <Select label={t('rooms.sortBy')} value={f.sort} onChange={(e) => set({ sort: e.target.value }, true)} className="ms-auto w-full sm:w-64">
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`rooms.sort.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <p role="status" className="text-base font-bold text-ink">
            {isLoading ? t('common.loading') : count}
          </p>
          {tier === 'desktop' ? (
            (['table', 'cards'] as const).map((v) => (
              <TabPanel key={v} idBase="rooms-view" value={v} active={f.view === v}>
                {results}
              </TabPanel>
            ))
          ) : (
            results
          )}
          {pages > 1 ? (
            <nav aria-label={t('rooms.pagination')} className="flex flex-wrap items-center justify-center gap-2">
              <IconButton icon={ChevronLeft} flipRtl label={t('rooms.prev')} variant="secondary" disabled={page <= 1} onClick={() => set({ page: page - 1 }, true)} />
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={t('rooms.page', { page: p })}
                  onClick={() => set({ page: p }, true)}
                  className={cn('min-h-12 min-w-12 rounded-control px-3 font-bold', p === page ? 'bg-primary text-on-primary' : 'border-control bg-card text-ink hover:bg-surface-2')}
                >
                  {formatNumber(p, lang)}
                </button>
              ))}
              <IconButton icon={ChevronRight} flipRtl label={t('rooms.next')} variant="secondary" disabled={page >= pages} onClick={() => set({ page: page + 1 }, true)} />
            </nav>
          ) : null}
        </section>
      </div>

      {tier !== 'desktop' ? (
        <BottomSheet
          open={sheetOpen}
          modal
          title={t('rooms.filters')}
          snap={snap}
          onSnapChange={setSnap}
          onClose={() => setSheetOpen(false)}
          footer={
            <Button size="lg" fullWidth onClick={() => setSheetOpen(false)}>
              {t('rooms.showResults', { count: all.length })}
            </Button>
          }
        >
          <Filters {...filters} />
        </BottomSheet>
      ) : null}
    </Page>
  );
}
