/**
 * Campus map: toolbar (building, floor, layers, map / list), the plan or its list
 * equivalent, the legend, and the room detail panel. Deep links:
 *   /map?room=A-104   /map?poi=<id>   /map?view=campus   /map?mode=list
 */
import { Boxes, Building2, Layers as LayersIcon, List, Map as MapIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAnnounce } from '@/a11y/Announcer';
import { useBuildings, useCampusOverview, useFloorPlan, useFloorSvgList, useSearchIndex } from '@/api/hooks';
import type { NearbyPoi } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Input';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { Page } from '@/components/shell/Page';
import { useRightPanel } from '@/components/shell/RightPanel';
import { RoomDetail } from '@/features/rooms/RoomDetail';
import { floorLabel } from '@/lib/floors';
import { useTier } from '@/lib/hooks';
import { useLiveFloors } from '@/realtime/liveRooms';
import { useMapPrefs } from '@/stores/mapPrefs';
import { usePreferences, type Lang } from '@/stores/preferences';
import { FloorMap, type MapItem } from './FloorMap';
import { IsometricCampusMap } from './IsometricCampusMap';
import { LayersControl, MapLegend } from './MapControls';
import { MapListView } from './MapListView';

export function MapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const announce = useAnnounce();
  const tier = useTier();
  const [params, setParams] = useSearchParams();
  const floorId = usePreferences((s) => s.floorId);
  const setFloorId = usePreferences((s) => s.setFloorId);
  const layers = useMapPrefs((s) => s.layers);
  const panel = useRightPanel();

  const navigate = useNavigate();
  const scope: 'floor' | 'campus' = params.get('view') === 'campus' ? 'campus' : 'floor';
  const rawMode = params.get('mode');
  // The live, accessible floor plan is the primary experience. The isometric
  // overview remains available as a secondary campus-orientation view.
  const mode: 'iso' | 'map' | 'list' = rawMode === 'list' ? 'list' : rawMode === 'iso' ? 'iso' : 'map';
  const roomCode = params.get('room');
  const poiId = params.get('poi');

  const buildings = useBuildings();
  const index = useSearchIndex();
  const plan = useFloorPlan(scope === 'floor' ? floorId : null);
  const overview = useCampusOverview(scope === 'campus');
  const svgSchemas = useFloorSvgList();


  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => {
    const first = buildings.data?.items[0]?.floors.find((f) => f.level === 0) ?? buildings.data?.items[0]?.floors[0];
    if (!floorId && first && !roomCode && !poiId) setFloorId(first.id);
  }, [floorId, buildings.data, roomCode, poiId, setFloorId]);

  const building = buildings.data?.items.find((b) => b.floors.some((f) => f.id === floorId)) ?? buildings.data?.items[0];
  const floor = building?.floors.find((f) => f.id === floorId);

  // Deep links pick the right floor.
  useEffect(() => {
    if (!index.data) return;
    const target = roomCode ? index.data.rooms.find((r) => r.code === roomCode)?.floorId : poiId ? index.data.pois.find((p) => p.id === poiId)?.floorId : undefined;
    if (target && target !== floorId) {
      setFloorId(target);
      if (scope === 'campus') update({ view: null });
    }
    if (poiId && !target && index.data.pois.some((p) => p.id === poiId) && scope !== 'campus') update({ view: 'campus' });
  }, [index.data, roomCode, poiId, floorId, scope, setFloorId, update]);

  // /map?building=A → that building's ground floor.
  const buildingCode = params.get('building');
  useEffect(() => {
    if (!buildingCode || !buildings.data) return;
    const b = buildings.data.items.find((x) => x.code === buildingCode);
    const ground = b?.floors.find((f) => f.level === 0) ?? b?.floors[0];
    if (ground) setFloorId(ground.id);
    update({ building: null, view: null });
  }, [buildingCode, buildings.data, setFloorId, update]);

  const roomId = roomCode ? index.data?.rooms.find((r) => r.code === roomCode)?.id : undefined;
  const selected: MapItem | null = roomId ? { kind: 'room', id: roomId } : poiId ? { kind: 'poi', id: poiId } : null;

  const selectRoomByCode = useCallback((code: string) => update({ room: code, poi: null }), [update]);
  const showPoi = useCallback((poi: NearbyPoi) => update({ poi: poi.id, room: null, mode: null }), [update]);

  const onSelect = (item: MapItem) => {
    if (item.kind === 'room') {
      const code = plan.data?.layers.rooms?.features.find((f) => f.id === item.id)?.properties.code;
      if (code) selectRoomByCode(code);
    } else if (item.kind === 'poi') {
      update({ poi: item.id, room: null });
    } else {
      const b = buildings.data?.items.find((x) => x.id === item.id);
      const ground = b?.floors.find((f) => f.level === 0) ?? b?.floors[0];
      if (ground) setFloorId(ground.id);
      update({ view: null, poi: null, room: null });
    }
  };

  // Room selected → detail panel; panel closed by the user → selection cleared.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (roomCode && opened.current !== roomCode) {
      opened.current = roomCode;
      panel.open({ title: roomCode, body: <RoomDetail key={roomCode} idOrCode={roomCode} onShowPoi={showPoi} onSelectRoom={selectRoomByCode} /> });
    } else if (!roomCode && opened.current) {
      opened.current = null;
      panel.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);
  const seenOpen = useRef(false);
  useEffect(() => {
    if (panel.panel) {
      seenOpen.current = true;
      return;
    }
    if (seenOpen.current && opened.current) {
      seenOpen.current = false;
      opened.current = null;
      update({ room: null });
    }
  }, [panel.panel, update]);

  // Live statuses for the floor shown (or the outdoors); announce changes of the selected room only.
  useLiveFloors(scope === 'floor' && floorId ? [floorId] : ['outdoor'], (e) => {
    if (e.code === roomCode) announce(t('map.statusChanged', { room: e.code, status: e.status.label }));
  });

  // "Show on the plan" from the list: focus the marker once the map has drawn it.
  useEffect(() => {
    if (mode !== 'map' || !poiId) return undefined;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-nav-key="poi:${poiId}"]`)?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, [mode, poiId, plan.data, overview.data]);

  const place = scope === 'campus' ? t('map.campus') : building && floor ? t('map.levelName', { building: lang === 'ar' ? building.nameAr : building.name, floor: floorLabel(floor.level, t) }) : t('map.noFloor');
  const query = scope === 'campus' ? overview : plan;
  const mobile = tier === 'mobile';
  const schemaMissing = svgSchemas.data !== undefined && !svgSchemas.data.items.some((item) => item.hasCustomSvg);

  const toolbar = (
    <div className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      <Select
        label={t('map.building')}
        icon={Building2}
        value={scope === 'campus' ? 'campus' : (building?.id ?? '')}
        onChange={(e) => {
          if (e.target.value === 'campus') {
            update({ view: 'campus', room: null, poi: null });
            return;
          }
          const b = buildings.data?.items.find((x) => x.id === e.target.value);
          const same = b?.floors.find((f) => f.level === floor?.level) ?? b?.floors[0];
          if (same) setFloorId(same.id);
          update({ view: null, room: null, poi: null });
        }}
        className="min-w-0 sm:w-60"
      >
        <option value="campus">{t('map.campus')}</option>
        {buildings.data?.items.map((b) => (
          <option key={b.id} value={b.id}>
            {lang === 'ar' ? b.nameAr : b.name}
          </option>
        ))}
      </Select>
      <Select
        label={t('map.floor')}
        icon={LayersIcon}
        value={scope === 'floor' ? (floorId ?? '') : ''}
        disabled={scope === 'campus' || !building}
        onChange={(e) => {
          setFloorId(e.target.value);
          update({ room: null, poi: null });
        }}
        className="min-w-0 sm:w-52"
      >
        {scope === 'campus' ? <option value="">{t('map.outdoors')}</option> : null}
        {building?.floors.map((f) => (
          <option key={f.id} value={f.id}>
            {floorLabel(f.level, t)}
          </option>
        ))}
      </Select>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:ms-auto">
        <LayersControl mobile={mobile} />
        <Tabs
          idBase="map-view"
          label={t('map.view')}
          value={mode}
          onChange={(m) => update({ mode: m === 'map' ? null : m })}
          items={[
            { value: 'map', label: t('map.mapView'), icon: MapIcon },
            { value: 'list', label: t('map.listView'), icon: List },
            { value: 'iso', label: t('map.campus'), icon: Boxes },
          ]}
        />
      </div>
    </div>
  );

  const body = schemaMissing ? (
    <EmptyState
      icon={MapIcon}
      title="The university map schema has not been uploaded yet."
      text="An administrator needs to upload the campus SVG before the map can be shown."
    />
  ) : query.isError ? (
    <ErrorState title={t('map.loadError')} onRetry={() => void query.refetch()} retryLabel={t('common.retry')} />
  ) : query.isLoading || !query.data ? (
    <div className="p-4">
      <Skeleton.Group>
        <Skeleton className="h-[min(60dvh,36rem)] w-full" />
      </Skeleton.Group>
    </div>
  ) : null;

  const views = useMemo(() => ({ plan: plan.data, overview: overview.data }), [plan.data, overview.data]);

  return (
    <Page title={t('page.map')} description={t('map.subtitle')} className="max-w-none">
      {toolbar}
      <p id="map-help" className="sr-only">
        {t('map.instructions')}
      </p>

      {/* 3D Isometric Campus Map matching user's uploaded mockup */}
      <TabPanel idBase="map-view" value="iso" active={mode === 'iso'}>
        {schemaMissing ? body : <IsometricCampusMap
          onSelectRoom={(code) => {
            selectRoomByCode(code);
          }}
          onOpenDijkstraRoute={(toTarget) => {
            navigate(`/navigate?to=${encodeURIComponent(toTarget)}`);
          }}
          onOpenFloorPlan={(flId) => {
            if (flId) setFloorId(flId);
            update({ mode: 'map', view: 'floor' });
          }}
        />}
      </TabPanel>

      <TabPanel idBase="map-view" value="map" active={mode === 'map'}>
        <Card padded={false} className="overflow-hidden">
          <section aria-label={t('map.regionLabel', { place })} className="relative h-[min(60dvh,40rem)] desk:h-[calc(100dvh-19rem)] desk:min-h-[28rem]">
            {body ?? (
              <FloorMap
                scope={scope}
                plan={views.plan}
                overview={views.overview}
                layers={layers}
                selected={selected}
                onSelect={onSelect}
                label={t('map.regionLabel', { place })}
                describedBy="map-help"
              />
            )}
            <div className="pointer-events-none absolute bottom-3 start-3 z-[400]">
              <MapLegend compact />
            </div>
          </section>
        </Card>
        <p className="mt-2 text-sm text-muted">{t('map.instructions')}</p>
      </TabPanel>
      <TabPanel idBase="map-view" value="list" active={mode === 'list'}>
        <Card padded={false}>
          {body ?? (
            <MapListView
              scope={scope}
              plan={views.plan}
              overview={views.overview}
              layers={layers}
              selected={selected}
              onSelect={(item) => {
                if (item.kind === 'poi') update({ poi: item.id, room: null, mode: null });
                else onSelect(item);
              }}
            />
          )}
        </Card>
      </TabPanel>

    </Page>
  );
}
