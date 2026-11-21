import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, ErrorState, InlineNotice, LoadingState, PageHeading, SectionTitle } from '@/components/ui';
import { campusApi } from '@/api/campus';
import { navigationApi } from '@/api/navigation';
import { useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';
import { panViewBox, screenToLocal, zoomViewBox, type ScreenPoint, type ViewBox } from '@/utils/mapCoordinates';
import type { Building, FloorPlan, GeoGeometry, LayerProperties, RouteLocation, RouteOption, RoutePlan, SearchIndex } from '@/types/api';
import { rememberPlace, toggleFavourite } from '@/services/localPlaces';
import { textToSpeechService } from '@/services/speech/tts';
import { speechToTextService } from '@/services/speech/stt';

type Place = { key: string; label: string; kind: 'room' | 'poi'; id: string; buildingCode: string; floorId: string | null; level: number };
type MapPoint = { x: number; y: number; floorId: string; level: number };
type MapBox = ViewBox;
type MapFeature = { id: string; geometry: GeoGeometry | null; properties: LayerProperties };
const POI_LAYERS = ['entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities'];

export default function CampusMapScreen() {
  const params = useLocalSearchParams<{ savedId?: string; savedType?: 'room' | 'poi'; savedName?: string; savedBuilding?: string; savedFloor?: string; savedLevel?: string; pickLocation?: string; returnTo?: string }>();
  const { t, palette, preferences, isRTL } = usePreferences();
  const { user } = useAuth();
  const campus = useQuery({ queryKey: ['campus-overview', preferences.locale], queryFn: () => campusApi.overview(preferences.locale) });
  const index = useQuery({ queryKey: ['search-index', preferences.locale], queryFn: () => campusApi.searchIndex(preferences.locale) });
  const [buildingCode, setBuildingCode] = useState('');
  const [floorId, setFloorId] = useState('');
  const [query, setQuery] = useState('');
  const [targetField, setTargetField] = useState<'from' | 'to' | null>(null);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  const [pickPoint, setPickPoint] = useState(params.pickLocation === '1');
  const [wheelchair, setWheelchair] = useState(user?.accessibilityProfile?.mobility === 'WHEELCHAIR' || user?.accessibilityProfile?.stepFree || false);
  const [activeRoute, setActiveRoute] = useState<RoutePlan | null>(null);
  const [selectedOption, setSelectedOption] = useState<'fastest' | 'step-free'>('fastest');
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>([]);
  const [isVoiceListening, setIsVoiceListening] = useState(false);

  const buildings = useMemo(() => campus.data?.buildings ?? [], [campus.data?.buildings]);
  const selectedBuilding = buildings.find(item => item.code === buildingCode) ?? buildings[0];
  const floors = selectedBuilding?.floors ?? [];
  const currentFloor = floors.find(item => item.id === floorId) ?? floors[0];
  const floorPlan = useQuery({ queryKey: ['floor-plan', currentFloor?.id, preferences.locale], queryFn: () => campusApi.floorPlan(currentFloor!.id, preferences.locale), enabled: !!currentFloor?.id });
  const results = useMemo(() => searchPlaces(index.data, query, preferences.locale).slice(0, 8), [index.data, query, preferences.locale]);
  const isPickingForReport = params.pickLocation === '1';

  // Saved destinations are supplied by home/favourites; use the backend search index's
  // room code or POI ID as the actual route location identifier.
  useEffect(() => {
    if (!params.savedId || !params.savedType || !params.savedName || !buildings.length) return;
    const place: Place = { key: `${params.savedType}:${params.savedId}`, id: params.savedId, label: params.savedName, kind: params.savedType, buildingCode: params.savedBuilding ?? '', floorId: params.savedFloor ?? null, level: Number(params.savedLevel ?? 0) };
    // Route parameters arrive asynchronously after the campus index; synchronize them into the route form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTo(place);
    setActiveRoute(null);
    const building = buildings.find(item => item.code === place.buildingCode);
    if (building) { setBuildingCode(building.code); if (place.floorId) setFloorId(place.floorId); }
  }, [params.savedId, params.savedType, params.savedName, params.savedBuilding, params.savedFloor, params.savedLevel, buildings]);

  const routeMutation = useMutation({
    mutationFn: async () => {
      const origin: RouteLocation | null = mapPoint && !from
        ? { type: 'point', x: mapPoint.x, y: mapPoint.y, level: mapPoint.level, floorId: mapPoint.floorId }
        : from ? { type: from.kind, id: from.id } : null;
      if (!origin || !to) throw new Error(t('selectLocation'));
      return navigationApi.plan({ from: origin, to: { type: to.kind, id: to.id }, mode: wheelchair ? 'wheelchair' : 'walking', options: wheelchair ? ['step-free'] : ['fastest'], constraints: { useProfile: true, avoidStairs: wheelchair || user?.accessibilityProfile?.stepFree }, shorelineHints: user?.accessibilityProfile?.shorelineHints, lang: preferences.locale });
    },
    onSuccess: async plan => {
      setActiveRoute(plan);
      setSelectedOption(wheelchair ? 'step-free' : 'fastest');
      if (to) await rememberPlace({ id: to.key, routeId: to.id, name: to.label, kind: to.kind, buildingCode: to.buildingCode, floorId: to.floorId ?? undefined, level: to.level });
    },
  });
  const route = activeRoute?.options.find(item => item.id === selectedOption) ?? activeRoute?.options[0];
  const routeFeatures = route?.geojson.find(item => item.floorId === currentFloor?.id)?.featureCollection.features ?? [];

  const choosePlace = (place: Place) => {
    if (targetField === 'from') { setFrom(place); setMapPoint(null); setActiveRoute(null); }
    else { setTo(place); setActiveRoute(null); }
    const building = buildings.find(item => item.code === place.buildingCode);
    if (building) { setBuildingCode(building.code); setFloorId(place.floorId ?? building.floors[0]?.id ?? ''); }
    setTargetField(null);
    setQuery('');
  };
  const selectMapPoint = (point: MapPoint) => {
    if (isPickingForReport) {
      router.replace({ pathname: '/report-obstacle', params: { x: String(point.x), y: String(point.y), floorId: point.floorId, level: String(point.level) } });
      return;
    }
    setMapPoint(point);
    setFrom(null);
    setActiveRoute(null);
    setPickPoint(false);
  };
  const activatePointPicker = () => { setPickPoint(true); setTargetField(null); setQuery(''); };
  const startLocation = from?.label ?? (mapPoint ? t('selectedPoint') : t('startLocation'));
  const destination = to?.label ?? t('destination');
  const startReport = () => router.push('/report-obstacle');
  const isRTLRow = isRTL ? 'row-reverse' : 'row';

  return <AppScreen>
    {/* Home Page Navbar with AccesU Logo */}
    <View
      style={{
        flexDirection: isRTLRow,
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        paddingHorizontal: 2,
        marginBottom: 6,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Image
          source={require('../../../assets/images/logo.png')}
          style={{ width: 44, height: 44 }}
          resizeMode="contain"
          accessibilityLabel="AccesU Logo"
        />
        <View>
          <AppText size={19} weight="bold" color={palette.primary}>AccesU</AppText>
          <AppText size={11} color={palette.muted}>{t('campus')}</AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reportObstacle')}
          onPress={startReport}
          style={{
            padding: 8,
            borderRadius: 12,
            backgroundColor: palette.surfaceRaised,
            borderWidth: 1,
            borderColor: palette.border,
          }}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={palette.accent} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('preferences')}
          onPress={() => router.push('/accessibility-settings')}
          style={{
            padding: 8,
            borderRadius: 12,
            backgroundColor: palette.surfaceRaised,
            borderWidth: 1,
            borderColor: palette.border,
          }}>
          <MaterialCommunityIcons name="cog-outline" size={20} color={palette.text} />
        </Pressable>
      </View>
    </View>

    <PageHeading eyebrow={t('campus')} title={t('map')} subtitle={t('shareRouteWarning')} />
    {campus.isLoading || index.isLoading ? <LoadingState label={t('loading')} /> : null}
    {campus.isError || index.isError ? <ErrorState message={t('networkError')} retryLabel={t('retry')} onRetry={() => { void campus.refetch(); void index.refetch(); }} /> : null}

    {!!buildings.length ? <Card style={{ gap: 12 }}>
      <SectionTitle title={t('chooseBuilding')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{buildings.map(item => <Chip key={item.id} label={localName(item, preferences.locale)} selected={item.code === selectedBuilding?.code} onPress={() => { setBuildingCode(item.code); setFloorId(item.floors[0]?.id ?? ''); setActiveRoute(null); setMapPoint(null); }} />)}</View>
      {!!floors.length ? <>
        <View style={{ height: 1, backgroundColor: palette.border }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><AppText weight="semibold">{t('chooseFloor')}</AppText><AppText size={12} color={palette.muted}>{floors.length} {t('floors')}</AppText></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{floors.map(item => <Chip key={item.id} label={item.name} selected={item.id === currentFloor?.id} onPress={() => setFloorId(item.id)} />)}</View>
      </> : null}
    </Card> : null}

    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><MaterialCommunityIcons name="map-marker-path" size={22} color={palette.accent} /><AppText size={18} weight="bold">{t('planRoute')}</AppText></View>
      <PlaceButton icon="circle-slice-8" label={t('startLocation')} value={startLocation} onPress={() => { setTargetField('from'); setQuery(''); }} />
      <PlaceButton icon="map-marker-check" label={t('destination')} value={destination} onPress={() => { setTargetField('to'); setQuery(''); }} />
      {targetField ? <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={t('searchPlaces')}
            placeholderTextColor={palette.muted}
            accessibilityLabel={t('searchPlaces')}
            style={{
              flex: 1,
              minHeight: 50,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 15,
              paddingHorizontal: 14,
              color: palette.text,
              backgroundColor: palette.surfaceRaised,
              textAlign: isRTL ? 'right' : 'left',
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dictée vocale"
            onPress={() => {
              if (isVoiceListening) {
                speechToTextService.stop();
                setIsVoiceListening(false);
              } else {
                setIsVoiceListening(true);
                if (speechToTextService.startListening) {
                  speechToTextService.startListening({
                    locale: preferences.locale,
                    onResult: (text) => {
                      setQuery(text);
                    },
                    onError: (err) => {
                      console.warn('[Map] Voice search error:', err);
                    },
                  });
                }
              }
            }}
            style={{
              display: Platform.OS === 'web' ? 'flex' : 'none',
              padding: 12,
              borderRadius: 15,
              backgroundColor: isVoiceListening ? palette.accent : palette.surfaceRaised,
              borderWidth: 1,
              borderColor: palette.border,
            }}
          >
            <MaterialCommunityIcons
              name={isVoiceListening ? 'microphone-settings' : 'microphone'}
              size={22}
              color={isVoiceListening ? '#FFFFFF' : palette.primary}
            />
          </Pressable>
        </View>
        {isVoiceListening ? (
          <InlineNotice tone="info">Écoute vocale active... Parlez pour chercher un lieu.</InlineNotice>
        ) : null}
        {results.map(place => <View key={place.key} style={{ flexDirection: isRTLRow, alignItems: 'center', borderBottomWidth: 1, borderColor: palette.border }}>
          <Pressable accessibilityRole="button" onPress={() => choosePlace(place)} style={{ flex: 1, paddingVertical: 11, gap: 2 }}>
            <AppText weight="semibold">{place.label}</AppText><AppText size={12} color={palette.muted}>{place.buildingCode} · {t('chooseFloor')} {place.level}</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save favourite" hitSlop={9} onPress={async () => { const next = await toggleFavourite({ id: place.key, name: place.label, kind: place.kind, buildingCode: place.buildingCode, floorId: place.floorId ?? undefined, level: place.level }); setFavoriteKeys(next.map(item => item.id)); }}>
            <MaterialCommunityIcons name={favoriteKeys.includes(place.key) ? 'star' : 'star-outline'} size={22} color={palette.accent} />
          </Pressable>
        </View>)}
        {query && !results.length ? <AppText size={13} color={palette.muted}>{t('noResults')}</AppText> : null}
        <Button title={t('cancel')} variant="ghost" onPress={() => setTargetField(null)} />
      </View> : null}
      <View style={{ flexDirection: isRTLRow, alignItems: 'center', gap: 8 }}>
        <MaterialCommunityIcons name={wheelchair ? 'wheelchair-accessibility' : 'walk'} size={20} color={palette.primary} />
        <AppText weight="semibold" style={{ flex: 1 }}>{t('routeOptions')}</AppText>
        <Chip label={t('walking')} selected={!wheelchair} onPress={() => { if (wheelchair) setActiveRoute(null); setWheelchair(false); }} />
        <Chip label={t('wheelchair')} selected={wheelchair} onPress={() => { if (!wheelchair) setActiveRoute(null); setWheelchair(true); }} />
      </View>
      <Button title={t('getRoute')} onPress={() => routeMutation.mutate()} loading={routeMutation.isPending} disabled={(!from && !mapPoint) || !to || !!targetField} icon={<MaterialCommunityIcons name="arrow-right" size={19} color={palette.accentText} />} />
      {routeMutation.isError ? <InlineNotice tone="danger">{routeMutation.error instanceof Error ? routeMutation.error.message : t('networkError')}</InlineNotice> : null}
    </Card>

    {floorPlan.isLoading ? <LoadingState label={t('loading')} /> : null}
    {floorPlan.isError ? <ErrorState message={t('noMapData')} retryLabel={t('retry')} onRetry={() => void floorPlan.refetch()} /> : null}
    {floorPlan.data ? <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: isRTLRow, alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}><AppText size={17} weight="bold">{selectedBuilding?.name}</AppText><AppText size={13} color={palette.muted}>{currentFloor?.name} · Level {currentFloor?.level}</AppText></View>
        {isPickingForReport ? <Chip label={t('pickLocation')} selected /> : <Button title={pickPoint ? t('cancel') : t('pickLocation')} variant="outline" onPress={() => pickPoint ? setPickPoint(false) : activatePointPicker()} style={{ minHeight: 42, paddingHorizontal: 10 }} />}
      </View>
      {pickPoint || isPickingForReport ? <InlineNotice>{t('pickLocation')}</InlineNotice> : null}
      <FloorMap key={currentFloor?.id} plan={floorPlan.data} routeFeatures={routeFeatures} route={route} routePlan={activeRoute ?? undefined} buildingCode={selectedBuilding?.code ?? ''} onPoint={selectMapPoint} onMarkerSelect={place => { if (targetField === 'from') { setFrom(place); setMapPoint(null); } else setTo(place); setTargetField(null); setActiveRoute(null); }} palette={palette} picking={pickPoint || isPickingForReport} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Legend icon="school-outline" label={t('rooms')} palette={palette} />
        <Legend icon="road-variant" label={t('corridors')} palette={palette} />
        <Legend icon="door-open" label={t('entrances')} palette={palette} />
        <Legend icon="elevator-passenger" label={t('elevators')} palette={palette} />
        <Legend icon="stairs" label={t('stairs')} palette={palette} />
        <Legend icon="wheelchair-accessibility" label={t('ramps')} palette={palette} />
        <Legend icon="toilet" label={t('toilets')} palette={palette} />
        <Legend icon="alert-circle-outline" label={t('blocked')} palette={palette} />
      </View>
      <AppText size={12} color={palette.muted}>{t('mapCoordinateNote')}</AppText>
    </Card> : null}

    {activeRoute && route ? <Card style={{ gap: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <SectionTitle title={t('routeSummary')} />
        <Chip
          label={`Dijkstra : ${activeRoute.engine || 'stand-in-dijkstra'}`}
          selected
          icon={<MaterialCommunityIcons name="graphql" size={15} color={palette.onPrimary} />}
        />
        <Button
          title="Écouter l’itinéraire"
          variant="outline"
          icon={<MaterialCommunityIcons name="volume-high" size={18} color={palette.primary} />}
          onPress={() => {
            const summary = `Itinéraire Dijkstra : distance de ${Math.round(route.distanceM)} mètres, durée estimée de ${Math.max(1, Math.round(route.etaSec / 60))} minutes. ${route.steps.map((s, idx) => `Étape ${idx + 1} : ${s.instruction}`).join('. ')}`;
            void textToSpeechService.speak(summary, { locale: preferences.locale });
          }}
          style={{ minHeight: 40 }}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{activeRoute.options.map(option => <Chip key={option.id} label={option.label} selected={option.id === route.id} onPress={() => setSelectedOption(option.id)} />)}</View>
      <View style={{ flexDirection: 'row', gap: 10 }}><Metric icon="map-marker-distance" title={`${Math.round(route.distanceM)} m`} label={t('distance')} /><Metric icon="clock-outline" title={`${Math.max(1, Math.round(route.etaSec / 60))} min`} label={t('time')} /></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Chip label={`${route.elevatorCount} ${t('elevators')}`} icon={<MaterialCommunityIcons name="elevator" size={16} color={palette.primary} />} /><Chip label={`${route.rampCount} ${t('ramps')}`} icon={<MaterialCommunityIcons name="wheelchair-accessibility" size={16} color={palette.primary} />} />{!wheelchair ? <Chip label={`${route.stairsCount} ${t('stairs')}`} icon={<MaterialCommunityIcons name="stairs" size={16} color={palette.primary} />} /> : null}</View>
      {route.warnings.map(warning => <InlineNotice key={warning.code} tone="warning">{warning.message}</InlineNotice>)}
      {route.steps.length ? <><SectionTitle title={t('routeSteps')} />{route.steps.map(step => <View key={step.index} style={{ flexDirection: isRTLRow, gap: 12, alignItems: 'flex-start' }}><View style={{ width: 30, height: 30, borderRadius: 11, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }}><AppText size={13} weight="bold" color={palette.accentText}>{step.index + 1}</AppText></View><View style={{ flex: 1, gap: 2 }}><AppText weight="semibold">{step.instruction}</AppText><AppText size={12} color={palette.muted}>{step.distanceM > 0 ? `${Math.round(step.distanceM)} m` : ''}{step.landmark ? ` · ${step.landmark}` : ''}</AppText></View></View>)}</> : <AppText color={palette.muted}>{t('noRouteData')}</AppText>}
    </Card> : activeRoute ? <Card><AppText weight="bold">{t('unavailable')}</AppText>{activeRoute.unavailable.map((item, i) => <AppText key={`${item.option}-${i}`} color={palette.muted}>{item.message}</AppText>)}</Card> : null}

    <Button title={t('reportObstacle')} variant="outline" onPress={startReport} icon={<MaterialCommunityIcons name="alert-outline" size={18} color={palette.primary} />} />
  </AppScreen>;
}

function PlaceButton({ icon, label, value, onPress }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; value: string; onPress: () => void }) {
  const { palette, isRTL } = usePreferences();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 16, backgroundColor: palette.surfaceRaised, opacity: pressed ? 0.8 : 1 })}>
    <MaterialCommunityIcons name={icon} size={21} color={palette.accent} /><View style={{ flex: 1, gap: 2 }}><AppText size={12} color={palette.muted}>{label}</AppText><AppText weight="semibold" numberOfLines={1}>{value}</AppText></View><MaterialCommunityIcons name="magnify" size={19} color={palette.muted} />
  </Pressable>;
}

function searchPlaces(index: SearchIndex | undefined, query: string, locale: 'en' | 'fr' | 'ar'): Place[] {
  if (!index) return [];
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const rooms: Place[] = index.rooms.filter(item => `${item.code} ${item.name} ${item.nameAr ?? ''} ${item.buildingCode}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `room:${item.id}`, id: item.code, label: locale === 'ar' && item.nameAr ? item.nameAr : item.name, kind: 'room', buildingCode: item.buildingCode, floorId: item.floorId, level: item.level }));
  const pois: Place[] = index.pois.filter(item => `${item.name} ${item.nameAr ?? ''} ${item.type} ${item.buildingCode ?? ''}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `poi:${item.id}`, id: item.id, label: locale === 'ar' && item.nameAr ? item.nameAr : item.name, kind: 'poi', buildingCode: item.buildingCode ?? '', floorId: item.floorId, level: item.level }));
  return [...rooms, ...pois].slice(0, 15);
}
function localName(building: Building, locale: 'en' | 'fr' | 'ar') { return locale === 'ar' ? building.nameAr : building.name; }

function Metric({ icon, title, label }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; label: string }) {
  const { palette } = usePreferences();
  return <View style={{ flex: 1, backgroundColor: palette.surfaceRaised, borderRadius: 16, padding: 13, gap: 4 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><MaterialCommunityIcons name={icon} size={17} color={palette.accent} /><AppText weight="bold">{title}</AppText></View><AppText size={12} color={palette.muted}>{label}</AppText></View>;
}
function Legend({ icon, label, palette }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; palette: ReturnType<typeof usePreferences>['palette'] }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><MaterialCommunityIcons name={icon} size={16} color={palette.primary} /><AppText size={11} color={palette.muted}>{label}</AppText></View>;
}

function FloorMap({ plan, routeFeatures, route, routePlan, buildingCode, onPoint, onMarkerSelect, palette, picking }: { plan: FloorPlan; routeFeatures: MapFeature[]; route?: RouteOption; routePlan?: RoutePlan; buildingCode: string; onPoint: (point: MapPoint) => void; onMarkerSelect: (place: Place) => void; palette: ReturnType<typeof usePreferences>['palette']; picking: boolean }) {
  const { t } = usePreferences();
  const width = Math.max(1, plan.bounds[2] - plan.bounds[0]);
  const height = Math.max(1, plan.bounds[3] - plan.bounds[1]);
  const bounds = [0, 0, width, height] as const;
  const [box, setBox] = useState<MapBox>({ x: 0, y: 0, width, height });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const touch = useRef<{ point: ScreenPoint; box: MapBox; moved: boolean; pinchDistance?: number } | null>(null);
  const [point, setPoint] = useState<ScreenPoint | null>(null);
  const onLayout = (event: LayoutChangeEvent) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  const onStart = (event: GestureResponderEvent) => {
    const touches = event.nativeEvent.touches;
    const pinchDistance = touches.length >= 2 ? touchDistance(touches[0], touches[1]) : undefined;
    touch.current = { point: { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, box, moved: false, pinchDistance };
  };
  const onMove = (event: GestureResponderEvent) => {
    const gesture = touch.current;
    if (!gesture) return;
    const touches = event.nativeEvent.touches;
    if (touches.length >= 2) {
      const distance = touchDistance(touches[0], touches[1]);
      if (gesture.pinchDistance && distance > 0) setBox(zoomViewBox(gesture.box, gesture.pinchDistance / distance, bounds));
      gesture.moved = true;
      return;
    }
    const dx = event.nativeEvent.locationX - gesture.point.x;
    const dy = event.nativeEvent.locationY - gesture.point.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) gesture.moved = true;
    setBox(panViewBox(gesture.box, dx, dy, size, bounds));
  };
  const onEnd = (event: GestureResponderEvent) => {
    const gesture = touch.current;
    if (gesture && !gesture.moved && picking) {
      const local = screenToLocal({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, size, box);
      if (local) {
        const selected = { x: plan.bounds[0] + local.x, y: plan.bounds[3] - local.y, floorId: plan.floor.id, level: plan.floor.level };
        setPoint(local);
        onPoint(selected);
      }
    }
    touch.current = null;
  };
  const layers = Object.values(plan.layers).flatMap(collection => collection?.features ?? []);
  const routePaths = routeFeatures.flatMap(feature => feature.geometry ? [geometryPath(feature.geometry, plan.bounds)] : []);
  const path = (geometry: GeoGeometry | null) => geometry ? geometryPath(geometry, plan.bounds) : '';
  const routeStart = routePlan?.from.floorId === plan.floor.id ? { x: routePlan.from.x - plan.bounds[0], y: plan.bounds[3] - routePlan.from.y } : null;
  const routeEnd = routePlan?.to.floorId === plan.floor.id ? { x: routePlan.to.x - plan.bounds[0], y: plan.bounds[3] - routePlan.to.y } : null;
  const markerRadius = Math.max(2.1, Math.min(width, height) / 65);
  const zoom = (factor: number) => setBox(current => zoomViewBox(current, factor, bounds));

  return <View style={{ gap: 10 }}>
    <View onLayout={onLayout} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={() => { touch.current = null; }} accessibilityLabel={picking ? t('tapMap') : 'Interactive indoor campus floor plan'} accessibilityRole="image" style={{ height: 320, backgroundColor: palette.mapRoom, borderRadius: 18, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
        {plan.outline ? <Path d={path(plan.outline)} fill={palette.surface} stroke={palette.border} strokeWidth={Math.max(1, width / 500)} /> : null}
        {layers.map((feature, i) => {
          const props = feature.properties ?? {};
          const geometryPathData = path(feature.geometry);
          if (!geometryPathData) return null;
          const layer = props.layer;
          if (layer === 'walls') return <Path key={`${feature.id}-${i}`} d={geometryPathData} fill="none" stroke={palette.mapWall} strokeWidth={Math.max(1.2, width / 330)} strokeLinecap="round" />;
          if (layer === 'passages') return <Path key={`${feature.id}-${i}`} d={geometryPathData} fill="none" stroke={props.isOpen === false ? palette.mapBlocked : palette.mapWalkable} strokeOpacity={props.isOpen === false ? 0.9 : 0.55} strokeDasharray={props.isOpen === false ? '5 3' : undefined} strokeWidth={Math.max(2.2, width / 105)} strokeLinecap="round" />;
          if (layer === 'rooms') return <Path key={`${feature.id}-${i}`} d={geometryPathData} fill={palette.mapRoom} fillOpacity={0.8} stroke={palette.border} strokeWidth={Math.max(0.8, width / 520)} />;
          if (POI_LAYERS.includes(String(layer))) {
            const coords = geometryPoint(feature.geometry);
            if (!coords) return null;
            const centerX = coords[0] - plan.bounds[0];
            const centerY = plan.bounds[3] - coords[1];
            const fill = props.accessible === false ? palette.warning : layer === 'stairs' ? palette.primary : palette.accent;
            const label = layer === 'entrances' ? 'E' : layer === 'elevators' ? 'L' : layer === 'stairs' ? 'S' : layer === 'ramps' ? 'R' : layer === 'toilets' || layer === 'accessible_toilets' ? 'W' : '+';
            const name = typeof props.name === 'string' ? props.name : typeof props.nameAr === 'string' ? props.nameAr : String(layer);
            const markerLabel = `${name}${props.accessible === false ? ', inaccessible' : ''}`;
            return <React.Fragment key={`${feature.id}-${i}`}><Circle cx={centerX} cy={centerY} r={markerRadius} fill={fill} stroke={palette.surface} strokeWidth={Math.max(0.8, width / 480)} accessible accessibilityLabel={markerLabel} onPress={() => onMarkerSelect({ key: `poi:${feature.id}`, id: feature.id, label: name, kind: 'poi', buildingCode, floorId: plan.floor.id, level: plan.floor.level })} /><SvgText x={centerX} y={centerY + markerRadius * 0.34} textAnchor="middle" fontSize={markerRadius * 0.9} fontWeight="700" fill={palette.accentText} pointerEvents="none">{label}</SvgText></React.Fragment>;
          }
          return null;
        })}
        {routePaths.map((pathData, i) => <Path key={`route-${i}`} d={pathData} fill="none" stroke={palette.accent} strokeWidth={Math.max(3, width / 80)} strokeLinecap="round" strokeLinejoin="round" />)}
        {route?.steps.filter(step => step.floorId === plan.floor.id).map(step => <Circle key={`step-${step.index}`} cx={step.x - plan.bounds[0]} cy={plan.bounds[3] - step.y} r={Math.max(1.5, markerRadius * 0.45)} fill={palette.primary} stroke={palette.surface} strokeWidth={Math.max(0.7, width / 600)} />)}
        {route?.steps.filter(step => step.floorId === plan.floor.id && step.landmark).map(step => <SvgText key={`landmark-${step.index}`} x={step.x - plan.bounds[0]} y={plan.bounds[3] - step.y - box.height / 35} fontSize={Math.max(3, width / 95)} fontWeight="600" fill={palette.text}>{step.landmark}</SvgText>)}
        {routeStart ? <><Circle cx={routeStart.x} cy={routeStart.y} r={markerRadius * 1.35} fill={palette.primary} stroke={palette.surface} strokeWidth={Math.max(1, width / 450)} /><SvgText x={routeStart.x} y={routeStart.y + markerRadius * 0.35} textAnchor="middle" fontSize={markerRadius} fontWeight="700" fill={palette.primaryText}>A</SvgText></> : null}
        {routeEnd ? <><Circle cx={routeEnd.x} cy={routeEnd.y} r={markerRadius * 1.35} fill={palette.accent} stroke={palette.surface} strokeWidth={Math.max(1, width / 450)} /><SvgText x={routeEnd.x} y={routeEnd.y + markerRadius * 0.35} textAnchor="middle" fontSize={markerRadius} fontWeight="700" fill={palette.accentText}>B</SvgText></> : null}
        {point ? <Circle cx={point.x} cy={point.y} r={markerRadius * 1.25} fill={palette.danger} stroke={palette.surface} strokeWidth={1.2} /> : null}
      </Svg>
      {!picking && layers.length === 0 ? <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 18 }}><AppText color={palette.muted}>{t('noMapLayers')}</AppText></View> : null}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <AppText size={12} color={palette.muted}>{picking ? t('tapMap') : t('dragMap')}</AppText>
      <View style={{ flexDirection: 'row', gap: 8 }}><Button title="−" variant="outline" accessibilityHint="Zoom out on map" onPress={() => zoom(1.25)} style={{ minHeight: 42, minWidth: 48 }} /><Button title="+" variant="outline" accessibilityHint="Zoom in on map" onPress={() => zoom(0.8)} style={{ minHeight: 42, minWidth: 48 }} /></View>
    </View>
  </View>;
}

function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) { return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY); }
function geometryPoint(geometry: GeoGeometry | null): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString' || geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return null;
  return null;
}
function geometryPath(geometry: GeoGeometry, bounds: [number, number, number, number]): string {
  const xy = (position: readonly number[]) => [position[0] - bounds[0], bounds[3] - position[1]];
  const pathLine = (points: readonly (readonly number[])[], close = false) => points.length < 2 ? '' : points.map((point, i) => { const [x, y] = xy(point); return `${i ? 'L' : 'M'} ${x} ${y}`; }).join(' ') + (close ? ' Z' : '');
  switch (geometry.type) {
    case 'Point': return '';
    case 'LineString': return pathLine(geometry.coordinates);
    case 'MultiLineString': return geometry.coordinates.map(line => pathLine(line)).join(' ');
    case 'Polygon': return geometry.coordinates.map(ring => pathLine(ring, true)).join(' ');
    case 'MultiPolygon': return geometry.coordinates.map(polygon => polygon.map(ring => pathLine(ring, true)).join(' ')).join(' ');
  }
}
