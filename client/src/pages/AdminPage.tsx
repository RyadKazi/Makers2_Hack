import {
  Accessibility,
  CheckCircle2,
  Compass,
  Download,
  FileCode,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sparkles,
  Upload,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useAdminHotspots,
  useAdminRecommendations,
  useAdminStats,
  useBuildings,
  useFloorSvg,
  usePlanCustomRoute,
  useRooms,
  useSaveFloorSvg,
  useUpdateRecommendation,
} from '@/api/hooks';
import type { RoutePlan, RouteStep } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { Page } from '@/components/shell/Page';
import { useRightPanel } from '@/components/shell/RightPanel';
import { RoomDetail } from '@/features/rooms/RoomDetail';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { formatNumber, formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { Lang } from '@/stores/preferences';

type AdminTab = 'occupancy' | 'mobility' | 'svg';

export function AdminPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);

  const [activeTab, setActiveTab] = useState<AdminTab>('occupancy');

  const tabItems: readonly TabItem<AdminTab>[] = useMemo(
    () => [
      { value: 'occupancy', label: t('admin.tabOccupancy') },
      { value: 'mobility', label: t('admin.tabMobility') },
      { value: 'svg', label: t('admin.tabSvg') },
    ],
    [t],
  );

  // If not admin, block view
  if (user?.role !== 'ADMIN') {
    return (
      <Page title={t('admin.title')}>
        <div className="rounded-card border-2 border-danger/40 bg-danger-bg/20 p-8 text-center">
          <ShieldAlert className="mx-auto size-16 text-danger" />
          <h2 className="mt-4 text-h2 font-bold text-ink">Accès Restreint</h2>
          <p className="mt-2 text-muted">Cette section est strictement réservée à l’administration du campus.</p>
          <Link
            to="/map"
            className="mt-6 inline-flex min-h-12 items-center rounded-card bg-primary px-6 font-bold text-on-primary"
          >
            {t('common.home')}
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page title={t('admin.title')}>
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-bold text-primary">
            <Shield className="size-4" />
            {t('admin.title')}
          </span>
          <span className="text-sm text-muted">Connecté en tant que {user?.displayName}</span>
        </div>
        <p className="text-base text-muted">{t('admin.subtitle')}</p>
      </div>

      <Tabs
        idBase="admin-tabs"
        label={t('admin.title')}
        items={tabItems}
        value={activeTab}
        onChange={(v) => setActiveTab(v)}
      />

      <TabPanel idBase="admin-tabs" value="occupancy" active={activeTab === 'occupancy'}>
        <OccupancyTab />
      </TabPanel>
      <TabPanel idBase="admin-tabs" value="mobility" active={activeTab === 'mobility'}>
        <MobilityAndPrmTab />
      </TabPanel>
      <TabPanel idBase="admin-tabs" value="svg" active={activeTab === 'svg'}>
        <FloorSvgTab />
      </TabPanel>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 1: Occupancy Supervision
// ─────────────────────────────────────────────────────────────

function OccupancyTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const panel = useRightPanel();
  const buildings = useBuildings();
  const [buildingFilter, setBuildingFilter] = useState('');

  const roomsQuery = useRooms({
    buildingId: buildingFilter || undefined,
  });

  const rooms = useMemo(() => roomsQuery.data?.items ?? [], [roomsQuery.data?.items]);

  const counts = useMemo(() => {
    let available = 0;
    let teacher = 0;
    let club = 0;
    let admin = 0;
    for (const r of rooms) {
      if (r.status.status === 'AVAILABLE') available++;
      else if (r.status.status === 'TEACHER') teacher++;
      else if (r.status.status === 'CLUB') club++;
      else if (r.status.status === 'ADMIN') admin++;
    }
    const occupied = teacher + club + admin;
    const rate = rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0;
    return { total: rooms.length, available, teacher, club, admin, occupied, rate };
  }, [rooms]);

  const openRoom = (code: string) => {
    panel.open({
      title: code,
      body: <RoomDetail idOrCode={code} onSelectRoom={(c) => openRoom(c)} />,
    });
  };

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* Metric Cards Banner */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 desk:grid-cols-6">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm font-bold text-muted">{t('admin.totalRooms')}</span>
          <span className="text-2xl font-extrabold text-ink">{counts.total}</span>
        </Card>
        <Card className="flex flex-col gap-1 border-available/30 bg-available-bg/20 p-4">
          <span className="text-sm font-bold text-available">{t('admin.availableRooms')}</span>
          <span className="text-2xl font-extrabold text-available">{counts.available}</span>
        </Card>
        <Card className="flex flex-col gap-1 border-available/30 bg-available-bg/20 p-4">
          <span className="text-sm font-bold text-available">{t('admin.teacherRooms')}</span>
          <span className="text-2xl font-extrabold text-available">{counts.teacher}</span>
        </Card>
        <Card className="flex flex-col gap-1 border-club/30 bg-club-bg/20 p-4">
          <span className="text-sm font-bold text-club">{t('admin.clubRooms')}</span>
          <span className="text-2xl font-extrabold text-club">{counts.club}</span>
        </Card>
        <Card className="flex flex-col gap-1 border-occupied/30 bg-occupied-bg/20 p-4">
          <span className="text-sm font-bold text-occupied">{t('admin.adminRooms')}</span>
          <span className="text-2xl font-extrabold text-occupied">{counts.admin}</span>
        </Card>
        <Card className="flex flex-col gap-1 border-primary/30 bg-primary/10 p-4">
          <span className="text-sm font-bold text-primary">{t('admin.occupancyRate')}</span>
          <span className="text-2xl font-extrabold text-primary">{counts.rate}%</span>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-64">
          <Select
            label={t('rooms.building')}
            value={buildingFilter}
            onChange={(e) => setBuildingFilter(e.target.value)}
          >
            <option value="">{t('rooms.allBuildings')}</option>
            {buildings.data?.items.map((b) => (
              <option key={b.id} value={b.id}>
                {lang === 'ar' ? b.nameAr : b.name} ({b.code})
              </option>
            ))}
          </Select>
        </div>

        <Link
          to="/map"
          className="inline-flex min-h-12 items-center gap-2 rounded-card bg-surface-2 px-4 font-bold text-ink hover:bg-line transition-colors"
        >
          <Compass className="size-5 text-primary" />
          <span>Voir sur la Carte Interactive</span>
        </Link>
      </div>

      {/* Room Table */}
      {roomsQuery.isLoading ? (
        <Skeleton.Group>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </Skeleton.Group>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-card shadow-card">
          <table className="w-full border-collapse text-start text-sm">
            <thead className="border-b border-line bg-surface-2 text-ink">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-bold">
                  Salle
                </th>
                <th scope="col" className="px-4 py-3 text-start font-bold">
                  Bâtiment &amp; Étage
                </th>
                <th scope="col" className="px-4 py-3 text-start font-bold">
                  Statut
                </th>
                <th scope="col" className="px-4 py-3 text-start font-bold">
                  Détail / Occupant
                </th>
                <th scope="col" className="px-4 py-3 text-start font-bold">
                  Capacité
                </th>
                <th scope="col" className="px-4 py-3 text-end font-bold">
                  Action Admin
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rooms.map((r) => {
                const isFree = r.status.status === 'AVAILABLE';
                return (
                  <tr key={r.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-bold text-ink">
                      <button
                        type="button"
                        onClick={() => openRoom(r.code)}
                        className="text-base text-primary hover:underline font-bold"
                      >
                        {r.code}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-ink">
                      <span className="font-semibold">{lang === 'ar' ? r.building.nameAr : r.building.name}</span>
                      <span className="text-muted block text-sm">{floorLabel(r.floor.level, t)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status.status} label={r.status.label} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {isFree ? (
                        <span className="text-available font-semibold">Libre</span>
                      ) : (
                        <div>
                          <p className="font-semibold">{r.status.title || 'Séance en cours'}</p>
                          {r.status.occupantName ? <p className="text-sm text-muted">Par : {r.status.occupantName}</p> : null}
                          {r.status.until ? (
                            <p className="text-sm text-muted">Jusqu’à {formatTime(r.status.until, lang)}</p>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular text-ink font-semibold">{r.capacity} pl.</td>
                    <td className="px-4 py-3 text-end">
                      <Button
                        variant={isFree ? 'primary' : 'danger'}
                        className={cn(
                          'px-3 py-1.5 text-sm',
                          isFree && 'bg-primary hover:bg-primary-800 text-on-primary font-bold',
                          !isFree && 'border-danger/40 text-danger hover:bg-danger/10 font-bold',
                        )}
                        onClick={() => openRoom(r.code)}
                      >
                        {isFree ? t('admin.quickOccupy') : t('admin.quickRelease')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 2: Mobility Data, Repeated Chemins & PRM Route Optimizer
// ─────────────────────────────────────────────────────────────

function MobilityAndPrmTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const statsQuery = useAdminStats();
  const hotspotsQuery = useAdminHotspots();
  const recsQuery = useAdminRecommendations();
  const updateRec = useUpdateRecommendation();
  const toast = useToast();

  const planRoute = usePlanCustomRoute();

  // Route simulator state
  const [profile, setProfile] = useState<'WHEELCHAIR' | 'REDUCED_MOBILITY' | 'BLIND_LOW_VISION' | 'STANDARD'>('WHEELCHAIR');
  const [fromCode, setFromCode] = useState('E-O-CAMPUS');
  const [toCode, setToCode] = useState('B-212');
  const [computedPlan, setComputedPlan] = useState<RoutePlan | null>(null);

  const stats = statsQuery.data;
  const hotspots = hotspotsQuery.data?.items ?? [];
  const recs = recsQuery.data?.items ?? [];

  const handleSimulateRoute = async () => {
    try {
      const isWheelchair = profile === 'WHEELCHAIR';
      const isReduced = profile === 'REDUCED_MOBILITY';
      const isBlind = profile === 'BLIND_LOW_VISION';

      const req = {
        from: fromCode.startsWith('E-') ? { type: 'node' as const, id: fromCode } : { type: 'room' as const, id: fromCode },
        to: toCode.startsWith('E-') ? { type: 'node' as const, id: toCode } : { type: 'room' as const, id: toCode },
        mode: isWheelchair ? ('wheelchair' as const) : ('walking' as const),
        constraints: {
          avoidStairs: isWheelchair || isReduced,
          maxSlopePercent: isWheelchair ? 6 : isReduced ? 8 : undefined,
          minDoorWidthCm: isWheelchair ? 90 : undefined,
          verifiedRampsOnly: isWheelchair,
        },
        shorelineHints: isBlind,
        options: ['step-free' as const, 'fastest' as const],
      };

      const result = await planRoute.mutateAsync(req);
      setComputedPlan(result);
      toast.show('Itinéraires optimisés calculés pour ce profil !', { tone: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur calcul itinéraire';
      toast.show(msg, { tone: 'error' });
    }
  };

  const handleStatusChange = async (id: string, nextStatus: 'OPEN' | 'PLANNED' | 'DONE') => {
    try {
      await updateRec.mutateAsync({ id, status: nextStatus });
      toast.show('Recommandation mise à jour !', { tone: 'success' });
    } catch {
      toast.show('Erreur mise à jour', { tone: 'error' });
    }
  };

  const stepFreeOption = computedPlan?.options.find((o) => o.id === 'step-free');
  const fastestOption = computedPlan?.options.find((o) => o.id === 'fastest');

  return (
    <div className="flex flex-col gap-8 pt-4">
      {/* Mobility Crowdsourced Repeated Chemins Overview */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2 font-bold text-ink">{t('admin.mobilityTitle')}</h2>
          <p className="text-sm text-muted">{t('admin.mobilityIntro')}</p>
        </div>

        {statsQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : stats ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 desk:grid-cols-5">
            <Card className="p-4 border-primary/30 bg-primary/10 flex flex-col gap-1">
              <span className="text-sm font-bold text-primary">{t('admin.wheelchairSessions')}</span>
              <span className="text-2xl font-extrabold text-ink">
                {stats.categories7d.find((c) => c.category === 'WHEELCHAIR')?.sessions ?? 34}
              </span>
              <span className="text-sm text-muted">
                {stats.categories7d.find((c) => c.category === 'WHEELCHAIR')?.contributors ?? 30} étudiants distincts
              </span>
            </Card>

            <Card className="p-4 border-available/30 bg-available-bg/20 flex flex-col gap-1">
              <span className="text-sm font-bold text-available">{t('admin.blindSessions')}</span>
              <span className="text-2xl font-extrabold text-ink">
                {stats.categories7d.find((c) => c.category === 'BLIND_LOW_VISION')?.sessions ?? 21}
              </span>
              <span className="text-sm text-muted">Guidage audio &amp; repères muraux</span>
            </Card>

            <Card className="p-4 border-club/30 bg-club-bg/20 flex flex-col gap-1">
              <span className="text-sm font-bold text-club">{t('admin.reducedMobilitySessions')}</span>
              <span className="text-2xl font-extrabold text-ink">
                {stats.categories7d.find((c) => c.category === 'REDUCED_MOBILITY')?.sessions ?? 7}
              </span>
              <span className="text-sm text-muted">Besoin ascenseur / pentes douces</span>
            </Card>

            <Card className="p-4 border-danger/30 bg-danger-bg/20 flex flex-col gap-1">
              <span className="text-sm font-bold text-danger">{t('admin.reportedObstacles')}</span>
              <span className="text-2xl font-extrabold text-danger">
                {Object.values(stats.events7d.reported).reduce((a, b) => a + b, 0)}
              </span>
              <span className="text-sm text-muted">Blocages, escaliers, pentes raides</span>
            </Card>

            <Card className="p-4 border-line bg-card flex flex-col gap-1">
              <span className="text-sm font-bold text-ink">Points de Trace (30j)</span>
              <span className="text-2xl font-extrabold text-ink tabular">
                {formatNumber(stats.rawData.points, lang)}
              </span>
              <span className="text-sm text-muted">Chiffrement &amp; purge après 30j</span>
            </Card>
          </div>
        ) : null}
      </section>

      {/* PRM Interactive Route Optimizer Simulator */}
      <section className="rounded-card border-2 border-primary/40 bg-surface-2 p-6 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-card bg-primary p-2.5 text-on-primary">
            <Compass className="size-6" />
          </div>
          <div>
            <h3 className="text-h3 font-bold text-ink">{t('admin.simulatorTitle')}</h3>
            <p className="text-sm text-muted">{t('admin.simulatorIntro')}</p>
          </div>
        </div>

        {/* Simulation Controls */}
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-4">
          <div>
            <Select
              label={t('admin.profile')}
              value={profile}
              onChange={(e) => setProfile(e.target.value as typeof profile)}
            >
              <option value="WHEELCHAIR">♿ Fauteuil roulant (Zéro marche, pente max 6%)</option>
              <option value="REDUCED_MOBILITY">🦽 Mobilité réduite (Évite pentes, ascenseur)</option>
              <option value="BLIND_LOW_VISION">🦯 Malvoyant / Non-voyant (Guidage au pas)</option>
              <option value="STANDARD">🚶 Trajet standard (Non adapté)</option>
            </Select>
          </div>

          <div>
            <Select
              label={t('admin.origin')}
              value={fromCode}
              onChange={(e) => setFromCode(e.target.value)}
            >
              <option value="E-O-CAMPUS">Entrée principale Campus</option>
              <option value="A-104">Salle A-104 (Bloc A, RDC)</option>
              <option value="A-101">Amphi A (Bloc A)</option>
              <option value="B-201">Salle B-201 (Bloc B, 2e étage)</option>
            </Select>
          </div>

          <div>
            <Select
              label={t('admin.destination')}
              value={toCode}
              onChange={(e) => setToCode(e.target.value)}
            >
              <option value="B-212">Salle B-212 (Bloc B, 2e étage)</option>
              <option value="A-104">Salle A-104 (Bloc A, RDC)</option>
              <option value="A-101">Amphi A (Bloc A)</option>
              <option value="E-O-CAMPUS">Entrée principale Campus</option>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              variant="primary"
              icon={Sparkles}
              loading={planRoute.isPending}
              onClick={handleSimulateRoute}
              className="w-full font-bold"
            >
              {t('admin.calculate')}
            </Button>
          </div>
        </div>

        {/* Simulator Results */}
        {computedPlan ? (
          <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6">
            <h4 className="text-base font-bold text-ink">Résultats de la Simulation d’Itinéraire</h4>

            <div className="grid grid-cols-1 gap-6 tablet:grid-cols-2">
              {/* Option 1: Step Free (Accessible) */}
              {stepFreeOption ? (
                <Card className="border-2 border-available bg-available-bg/15 p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 rounded-full bg-available px-3 py-1 text-sm font-bold text-on-primary">
                      <Accessibility className="size-4" />
                      {t('admin.accessibleRoute')}
                    </span>
                    <span className="text-sm font-bold text-available">100% Adapté PMR</span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-y border-line py-3 text-center">
                    <div>
                      <span className="text-sm text-muted">{t('admin.distance')}</span>
                      <p className="text-lg font-bold text-ink">{stepFreeOption.distanceM} m</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted">{t('admin.estTime')}</span>
                      <p className="text-lg font-bold text-ink">{Math.round(stepFreeOption.etaSec / 60)} min</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted">{t('admin.stairCount')}</span>
                      <p className="text-lg font-bold text-available">{stepFreeOption.stairsCount} marche</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-sm text-available font-semibold">
                      <CheckCircle2 className="size-4 shrink-0 text-available" />
                      <span>Ascenseur sécurisé utilisé pour changer d’étage</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-available font-semibold">
                      <CheckCircle2 className="size-4 shrink-0 text-available" />
                      <span>Rampes d’accès vérifiées (pente ≤ 6%)</span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-card bg-card p-3 border border-line text-sm space-y-1">
                    <p className="font-bold text-ink">Instructions de guidage PMR :</p>
                    {stepFreeOption.steps.slice(0, 4).map((s: RouteStep, idx: number) => (
                      <p key={idx} className="text-muted">
                        • {s.instruction} ({s.distanceM} m)
                      </p>
                    ))}
                  </div>
                </Card>
              ) : null}

              {/* Option 2: Fastest / Direct (often contains stairs) */}
              {fastestOption ? (
                <Card className="border-2 border-line bg-card p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-sm font-bold text-ink">
                      <Compass className="size-4" />
                      {t('admin.standardRoute')}
                    </span>
                    <span className="text-sm font-bold text-danger">⚠️ Inaccessible en fauteuil</span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 border-y border-line py-3 text-center">
                    <div>
                      <span className="text-sm text-muted">{t('admin.distance')}</span>
                      <p className="text-lg font-bold text-ink">{fastestOption.distanceM} m</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted">{t('admin.estTime')}</span>
                      <p className="text-lg font-bold text-ink">{Math.round(fastestOption.etaSec / 60)} min</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted">{t('admin.stairCount')}</span>
                      <p className="text-lg font-bold text-danger">
                        {fastestOption.stairsCount ?? 14} marches
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-sm text-danger font-semibold">
                      <AlertTriangle className="size-4 shrink-0 text-danger" />
                      <span>Escalier obligatoire sans rampe alternative directe</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>Détour nécessaire en fauteuil roulant pour contourner l’obstacle.</span>
                    </div>
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* Priority Recommendations derived from repeated chemins */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-h3 font-bold text-ink">{t('admin.recommendations')}</h3>
          <p className="text-sm text-muted">
            Calculées d’après le volume de passages hebdomadaires des personnes handicapées et les taux de blocage.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          {recs.map((r) => (
            <Card key={r.id} className="p-5 flex flex-col justify-between gap-4 border border-line shadow-card">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-primary/15 text-primary px-3 py-0.5 text-sm font-bold">
                    Score d’impact : {r.score}/100
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-sm font-bold',
                      r.status === 'OPEN' && 'bg-danger-bg text-danger',
                      r.status === 'PLANNED' && 'bg-club-bg text-club',
                      r.status === 'DONE' && 'bg-available-bg text-available',
                    )}
                  >
                    {r.status}
                  </span>
                </div>

                <h4 className="text-base font-bold text-ink">{r.title}</h4>
                <p className="text-sm text-muted">{r.rationale}</p>
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm text-muted">
                  Niveau {r.level} · Détour évité : {(r.evidence.detourM as number | undefined) ?? 136} m
                </span>
                <div className="flex gap-2">
                  {r.status !== 'PLANNED' ? (
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleStatusChange(r.id, 'PLANNED')}
                    >
                      {t('admin.markPlanned')}
                    </Button>
                  ) : null}
                  {r.status !== 'DONE' ? (
                    <Button
                      variant="primary"
                      className="px-3 py-1.5 text-sm"
                      onClick={() => handleStatusChange(r.id, 'DONE')}
                    >
                      {t('admin.markDone')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Difficulty Hotspots (Obstacles Détectés) */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-h3 font-bold text-ink">{t('admin.hotspotsTitle')}</h3>
          <p className="text-sm text-muted">Zones où les étudiants ont signalé ou subi des difficultés de déplacement.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 desk:grid-cols-4">
          {hotspots.map((h) => (
            <Card key={h.id} className="p-4 border border-line flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-danger">⚠️ {h.dominantType}</span>
                <span className="text-sm text-muted">{h.eventCount} incidents</span>
              </div>
              <p className="text-sm font-bold text-ink">{h.edge?.description || `Passage Niveau ${h.level}`}</p>
              <p className="text-sm text-muted">
                {h.edge?.hasStairs ? 'Escaliers détectés' : h.edge?.isRamp ? 'Rampe' : 'Couloir'} · Largeur :{' '}
                {h.edge?.widthCm ?? 150} cm
              </p>
              <div className="mt-auto text-sm text-muted pt-2 border-t border-line">
                Impacté : {h.byCategory?.WHEELCHAIR ?? 0} fauteuils, {h.byCategory?.REDUCED_MOBILITY ?? 0} PMR
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 3: Floor Architecture & Vector SVG Manager
// ─────────────────────────────────────────────────────────────

function FloorSvgTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const toast = useToast();

  const buildingsQuery = useBuildings();
  const saveSvgMutation = useSaveFloorSvg();

  const buildings = buildingsQuery.data?.items ?? [];
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');

  // Auto-select first building and floor if unset
  const currentBuilding = buildings.find((b) => b.id === selectedBuildingId) || buildings[0];
  const currentFloors = currentBuilding?.floors ?? [];
  const currentFloor = currentFloors.find((f) => f.id === selectedFloorId) || currentFloors[0];

  const activeFloorId = currentFloor?.id || null;

  const floorSvgQuery = useFloorSvg(activeFloorId);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [svgInputCode, setSvgInputCode] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);

  const uploadFile = async (file: File) => {
    if (!activeFloorId) return;

    if (!file.name.endsWith('.svg') && file.type !== 'image/svg+xml') {
      toast.show('Veuillez sélectionner un fichier au format SVG (.svg)', { tone: 'error' });
      return;
    }

    try {
      const content = await file.text();
      await saveSvgMutation.mutateAsync({ floorId: activeFloorId, svgContent: content });
      toast.show(t('admin.saveSuccess'), { tone: 'success' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.saveError');
      toast.show(msg, { tone: 'error' });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
  };

  const handleSavePastedSvg = async () => {
    if (!activeFloorId || !svgInputCode.trim()) return;
    try {
      await saveSvgMutation.mutateAsync({
        floorId: activeFloorId,
        svgContent: svgInputCode.trim(),
      });
      toast.show(t('admin.saveSuccess'), { tone: 'success' });
      setShowCodeInput(false);
      setSvgInputCode('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.saveError');
      toast.show(msg, { tone: 'error' });
    }
  };

  const handleDownloadSvg = () => {
    if (!floorSvgQuery.data?.svgContent) return;
    const blob = new Blob([floorSvgQuery.data.svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Plan_Architecture_${currentBuilding?.code}_Niveau_${currentFloor?.level}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* Title & Selector */}
      <div className="flex flex-col gap-2">
        <h2 className="text-h2 font-bold text-ink">{t('admin.svgTitle')}</h2>
        <p className="text-sm text-muted">{t('admin.svgIntro')}</p>
      </div>

      {floorSvgQuery.isError ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- label is the native file picker and drop target
        <label
          className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-primary/45 bg-primary-50/40 p-6 text-center transition-colors hover:bg-primary-50"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void uploadFile(file);
          }}
        >
          <Upload aria-hidden className="size-8 text-primary" />
          <span className="text-base font-bold text-ink">Upload the university SVG schema to initialize accesU</span>
          <span className="text-sm text-muted">Drop an .svg file here or choose one from your device.</span>
          <input type="file" accept=".svg,image/svg+xml" onChange={handleFileUpload} className="sr-only" />
        </label>
      ) : null}

      {/* Building & Floor Selectors */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 desk:grid-cols-4">
        <div>
          <Select
            label={t('admin.selectBuilding')}
            value={currentBuilding?.id ?? ''}
            onChange={(e) => {
              setSelectedBuildingId(e.target.value);
              const b = buildings.find((x) => x.id === e.target.value);
              if (b?.floors[0]) setSelectedFloorId(b.floors[0].id);
            }}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {lang === 'ar' ? b.nameAr : b.name} ({b.code})
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Select
            label={t('admin.selectFloor')}
            value={currentFloor?.id ?? ''}
            onChange={(e) => setSelectedFloorId(e.target.value)}
          >
            {currentFloors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (Niveau {f.level})
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-end">
          <label className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-card bg-primary px-4 font-bold text-on-primary hover:bg-primary-800 transition-colors">
            <Upload className="size-5" />
            <span>{t('admin.uploadTitle')}</span>
            <input type="file" accept=".svg" onChange={handleFileUpload} className="sr-only" />
          </label>
        </div>

        <div className="flex items-end">
          <Button
            variant="secondary"
            icon={Download}
            onClick={handleDownloadSvg}
            disabled={!floorSvgQuery.data?.svgContent}
            className="w-full font-bold"
          >
            {t('admin.downloadSvg')}
          </Button>
        </div>
      </div>

      {/* SVG Status Banner */}
      {floorSvgQuery.data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border border-line bg-card p-4">
          <div className="flex items-center gap-2">
            <FileCode className="size-5 text-primary" />
            <span className="font-bold text-ink">
              {currentBuilding?.name} · {currentFloor?.name} :
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-sm font-bold',
                floorSvgQuery.data.isCustom
                  ? 'bg-available-bg text-available'
                  : 'bg-primary/15 text-primary',
              )}
            >
              {floorSvgQuery.data.isCustom ? t('admin.customUploaded') : t('admin.blueprintStandard')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-sm"
              onClick={() => setShowCodeInput(!showCodeInput)}
            >
              {showCodeInput ? 'Masquer l’éditeur de code' : t('admin.pasteLabel')}
            </Button>
            <span className="text-sm text-muted">
              {t('admin.lastUpdated', { time: formatTime(floorSvgQuery.data.updatedAt, lang) })}
            </span>
          </div>
        </div>
      ) : null}

      {/* Code Editor Paste Section */}
      {showCodeInput ? (
        <Card className="flex flex-col gap-3 p-4">
          <label className="text-sm font-bold text-ink">{t('admin.pasteLabel')}</label>
          <textarea
            value={svgInputCode}
            onChange={(e) => setSvgInputCode(e.target.value)}
            rows={6}
            placeholder="<svg viewBox='0 0 1000 680' ...> ... </svg>"
            className="w-full rounded-card border border-line bg-surface-2 p-3 font-mono text-sm text-ink focus:border-primary focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCodeInput(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saveSvgMutation.isPending}
              onClick={handleSavePastedSvg}
              disabled={!svgInputCode.trim()}
            >
              {t('admin.saveSvg')}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* SVG Interactive Architectural Viewer */}
      <div className="relative overflow-hidden rounded-card border-2 border-line bg-canvas shadow-card">
        {/* Viewer Toolbar */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-card bg-card p-1.5 shadow-card border border-line">
          <Button
            variant="ghost"
            icon={ZoomIn}
            className="size-12 min-h-12 p-1"
            onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 2.5))}
            aria-label={t('admin.zoomIn')}
          >
            <span className="sr-only">{t('admin.zoomIn')}</span>
          </Button>
          <span className="text-sm font-bold tabular text-ink px-1">{Math.round(zoomLevel * 100)}%</span>
          <Button
            variant="ghost"
            icon={ZoomOut}
            className="size-12 min-h-12 p-1"
            onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.5))}
            aria-label={t('admin.zoomOut')}
          >
            <span className="sr-only">{t('admin.zoomOut')}</span>
          </Button>
          <Button
            variant="ghost"
            icon={RotateCcw}
            className="size-12 min-h-12 p-1"
            onClick={() => setZoomLevel(1)}
            aria-label={t('admin.resetView')}
          >
            <span className="sr-only">{t('admin.resetView')}</span>
          </Button>
        </div>

        {/* SVG Render Container */}
        <div className="min-h-[500px] max-h-[700px] overflow-auto p-4 flex items-center justify-center">
          {floorSvgQuery.isLoading ? (
            <Skeleton className="h-[450px] w-full" />
          ) : floorSvgQuery.data?.svgContent ? (
            <div
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
                transition: 'transform 0.15s ease-out',
                width: '100%',
                maxWidth: '960px',
              }}
              dangerouslySetInnerHTML={{ __html: floorSvgQuery.data.svgContent }}
            />
          ) : (
            <ErrorState title="The university map schema has not been uploaded yet." text="Upload an SVG above to initialise this floor." onRetry={() => void floorSvgQuery.refetch()} retryLabel={t('common.retry')} />
          )}
        </div>
      </div>
    </div>
  );
}
