import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, EmptyState, ErrorState, LoadingState, PageHeading, SectionTitle } from '@/components/ui';
import { roomsApi, type RoomStatusCode, type RoomSummary } from '@/api/rooms';
import { usePreferences } from '@/state/preferences';

const STATUS_FILTERS: { key: string; label: string; code?: RoomStatusCode }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'AVAILABLE', label: 'Free Now', code: 'AVAILABLE' },
  { key: 'TEACHER', label: 'Classes', code: 'TEACHER' },
  { key: 'CLUB', label: 'Clubs', code: 'CLUB' },
  { key: 'ADMIN', label: 'Admin', code: 'ADMIN' },
];

export default function RoomsScreen() {
  const { t, palette, preferences, isRTL } = usePreferences();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [stepFreeOnly, setStepFreeOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedRoom, setSelectedRoom] = useState<RoomSummary | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['rooms-list', search, statusFilter, stepFreeOnly, preferences.locale],
    queryFn: () =>
      roomsApi.list({
        search: search.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        stepFree: stepFreeOnly,
        lang: preferences.locale,
      }),
  });

  const roomDetailQuery = useQuery({
    queryKey: ['room-detail', selectedRoom?.id, preferences.locale],
    queryFn: () => roomsApi.get(selectedRoom!.id, preferences.locale),
    enabled: !!selectedRoom?.id,
  });

  const getStatusColor = (code: RoomStatusCode) => {
    switch (code) {
      case 'AVAILABLE':
        return { text: palette.available, bg: palette.availableBg };
      case 'TEACHER':
      case 'ADMIN':
        return { text: palette.occupied, bg: palette.occupiedBg };
      case 'CLUB':
        return { text: palette.club, bg: palette.clubBg };
      default:
        return { text: palette.muted, bg: palette.surface2 };
    }
  };

  const getStatusLabel = (code: RoomStatusCode) => {
    switch (code) {
      case 'AVAILABLE':
        return t('freeStatus');
      case 'TEACHER':
        return 'Enseignant';
      case 'ADMIN':
        return 'Admin';
      case 'CLUB':
        return 'Club';
      default:
        return code;
    }
  };

  const isRTLRow = isRTL ? 'row-reverse' : 'row';

  return (
    <AppScreen>
      <PageHeading
        eyebrow="CAMPUSWAY"
        title={t('rooms')}
        subtitle={preferences.locale === 'fr' ? 'Recherchez une salle, consultez sa disponibilité et son équipement PMR' : 'Search rooms, check live occupancy and accessibility'}
        trailing={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('viewCards')}
              onPress={() => setViewMode('cards')}
              style={[styles.viewToggle, viewMode === 'cards' && { backgroundColor: palette.primary }]}>
              <MaterialCommunityIcons name="view-grid-outline" size={18} color={viewMode === 'cards' ? palette.onPrimary : palette.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('viewTable')}
              onPress={() => setViewMode('table')}
              style={[styles.viewToggle, viewMode === 'table' && { backgroundColor: palette.primary }]}>
              <MaterialCommunityIcons name="table" size={18} color={viewMode === 'table' ? palette.onPrimary : palette.text} />
            </Pressable>
          </View>
        }
      />

      {/* Search and Filters */}
      <Card style={{ gap: 12 }}>
        <View style={[styles.searchBox, { borderColor: palette.line, backgroundColor: palette.surface2 }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={palette.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('searchHint')}
            placeholderTextColor={palette.muted}
            style={[styles.searchInput, { color: palette.ink, textAlign: isRTL ? 'right' : 'left' }]}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <MaterialCommunityIcons name="close-circle" size={18} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Status Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STATUS_FILTERS.map(f => (
            <Chip
              key={f.key}
              label={f.label}
              selected={statusFilter === f.key}
              onPress={() => setStatusFilter(f.key)}
            />
          ))}
        </ScrollView>

        {/* Step-free toggle */}
        <View style={[styles.toggleRow, { flexDirection: isRTLRow }]}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: stepFreeOnly }}
            onPress={() => setStepFreeOnly(!stepFreeOnly)}
            style={[styles.checkbox, { borderColor: palette.primary, backgroundColor: stepFreeOnly ? palette.primary : 'transparent' }]}>
            {stepFreeOnly ? <MaterialCommunityIcons name="check" size={16} color={palette.onPrimary} /> : null}
          </Pressable>
          <Pressable onPress={() => setStepFreeOnly(!stepFreeOnly)} style={{ flex: 1 }}>
            <AppText weight="semibold" size={14}>{t('stepFree')}</AppText>
          </Pressable>
        </View>
      </Card>

      {/* Results */}
      {roomsQuery.isLoading ? <LoadingState label={t('loading')} /> : null}
      {roomsQuery.isError ? <ErrorState message={t('networkError')} retryLabel={t('retry')} onRetry={() => roomsQuery.refetch()} /> : null}

      {roomsQuery.data?.items.length === 0 ? (
        <EmptyState title="Aucune salle trouvée" detail="Modifiez vos critères ou désactivez les filtres pour voir d'autres résultats." />
      ) : null}

      {viewMode === 'cards' ? (
        <View style={{ gap: 12 }}>
          {roomsQuery.data?.items.map(room => {
            const stColor = getStatusColor(room.status.status);
            return (
              <Pressable key={room.id} onPress={() => setSelectedRoom(room)}>
                <Card style={{ gap: 10 }}>
                  <View style={[styles.cardHeader, { flexDirection: isRTLRow }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText size={18} weight="bold">{room.code}</AppText>
                      <AppText size={14} color={palette.muted}>
                        {preferences.locale === 'ar' && room.nameAr ? room.nameAr : room.name}
                      </AppText>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: stColor.bg }]}>
                      <AppText size={12} weight="bold" color={stColor.text}>
                        {room.status.label || getStatusLabel(room.status.status)}
                      </AppText>
                    </View>
                  </View>

                  <View style={[styles.metaRow, { flexDirection: isRTLRow }]}>
                    <View style={styles.metaItem}>
                      <MaterialCommunityIcons name="domain" size={16} color={palette.primary} />
                      <AppText size={13} color={palette.muted}>{room.building.name}</AppText>
                    </View>
                    <View style={styles.metaItem}>
                      <MaterialCommunityIcons name="account-group-outline" size={16} color={palette.primary} />
                      <AppText size={13} color={palette.muted}>{room.capacity} places</AppText>
                    </View>
                    {room.stepFreeAccess ? (
                      <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="wheelchair-accessibility" size={16} color={palette.available} />
                        <AppText size={13} color={palette.available}>PMR</AppText>
                      </View>
                    ) : null}
                    {room.hearingLoop ? (
                      <View style={styles.metaItem}>
                        <MaterialCommunityIcons name="ear-hearing" size={16} color={palette.primary} />
                        <AppText size={13} color={palette.primary}>BIM</AppText>
                      </View>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      ) : (
        /* Table View */
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={[styles.tableRow, styles.tableHeader, { backgroundColor: palette.surface2 }]}>
            <AppText size={13} weight="bold" style={{ width: 80 }}>Code</AppText>
            <AppText size={13} weight="bold" style={{ flex: 1 }}>Salle</AppText>
            <AppText size={13} weight="bold" style={{ width: 60, textAlign: 'center' }}>Cap.</AppText>
            <AppText size={13} weight="bold" style={{ width: 90, textAlign: 'right' }}>Statut</AppText>
          </View>
          {roomsQuery.data?.items.map(room => {
            const stColor = getStatusColor(room.status.status);
            return (
              <Pressable
                key={room.id}
                onPress={() => setSelectedRoom(room)}
                style={[styles.tableRow, { borderBottomColor: palette.line }]}>
                <AppText size={14} weight="bold" style={{ width: 80 }}>{room.code}</AppText>
                <AppText size={13} color={palette.muted} numberOfLines={1} style={{ flex: 1 }}>{room.name}</AppText>
                <AppText size={13} style={{ width: 60, textAlign: 'center' }}>{room.capacity}</AppText>
                <View style={[styles.statusBadgeSmall, { backgroundColor: stColor.bg }]}>
                  <AppText size={11} weight="bold" color={stColor.text}>
                    {room.status.status}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}

      {/* Room Detail Modal Sheet */}
      <Modal
        visible={!!selectedRoom}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedRoom(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedRoom(null)} />
          <View style={[styles.modalSheet, { backgroundColor: palette.card, borderColor: palette.line }]}>
            <View style={styles.sheetHandle} />

            <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
              {selectedRoom ? (
                <>
                  <View style={[styles.cardHeader, { flexDirection: isRTLRow }]}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <AppText size={24} weight="bold">{selectedRoom.code}</AppText>
                      <AppText size={16} color={palette.muted}>{selectedRoom.name}</AppText>
                    </View>
                    <Pressable onPress={() => setSelectedRoom(null)} hitSlop={12}>
                      <MaterialCommunityIcons name="close" size={24} color={palette.text} />
                    </Pressable>
                  </View>

                  {/* Status Banner */}
                  {(() => {
                    const stColor = getStatusColor(selectedRoom.status.status);
                    return (
                      <View style={[styles.statusBox, { backgroundColor: stColor.bg, borderColor: stColor.text }]}>
                        <MaterialCommunityIcons name="information" size={20} color={stColor.text} />
                        <View style={{ flex: 1 }}>
                          <AppText size={15} weight="bold" color={stColor.text}>
                            {selectedRoom.status.label}
                          </AppText>
                          {selectedRoom.status.title ? (
                            <AppText size={13} color={stColor.text}>{selectedRoom.status.title}</AppText>
                          ) : null}
                          {selectedRoom.status.until ? (
                            <AppText size={12} color={palette.muted}>Jusqu&apos;à {selectedRoom.status.until}</AppText>
                          ) : null}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Accessibility & Equipments */}
                  <Card style={{ gap: 10 }}>
                    <SectionTitle title={t('equipment')} />
                    <View style={styles.equipGrid}>
                      <View style={styles.equipItem}>
                        <MaterialCommunityIcons
                          name={selectedRoom.stepFreeAccess ? 'check-circle' : 'close-circle'}
                          size={20}
                          color={selectedRoom.stepFreeAccess ? palette.available : palette.muted}
                        />
                        <AppText size={14}>{t('stepFree')}</AppText>
                      </View>
                      <View style={styles.equipItem}>
                        <MaterialCommunityIcons name="wheelchair" size={20} color={palette.primary} />
                        <AppText size={14}>{selectedRoom.wheelchairSpaces} places fauteuil</AppText>
                      </View>
                      <View style={styles.equipItem}>
                        <MaterialCommunityIcons
                          name={selectedRoom.hearingLoop ? 'check-circle' : 'close-circle'}
                          size={20}
                          color={selectedRoom.hearingLoop ? palette.available : palette.muted}
                        />
                        <AppText size={14}>Boucle magnétique (BIM)</AppText>
                      </View>
                      <View style={styles.equipItem}>
                        <MaterialCommunityIcons name="door" size={20} color={palette.primary} />
                        <AppText size={14}>Porte large (90 cm)</AppText>
                      </View>
                    </View>
                  </Card>

                  {/* Schedule */}
                  {roomDetailQuery.data?.schedule ? (
                    <Card style={{ gap: 8 }}>
                      <SectionTitle title={t('schedule')} />
                      {roomDetailQuery.data.schedule.map(s => (
                        <View key={s.id} style={[styles.scheduleRow, { borderBottomColor: palette.line }]}>
                          <View style={styles.scheduleTime}>
                            <AppText size={13} weight="bold">{s.startsAt}</AppText>
                            <AppText size={12} color={palette.muted}>{s.endsAt}</AppText>
                          </View>
                          <View style={{ flex: 1 }}>
                            <AppText size={14} weight="semibold">{s.title}</AppText>
                            <AppText size={12} color={palette.muted}>{s.organizer}</AppText>
                          </View>
                        </View>
                      ))}
                    </Card>
                  ) : null}

                  {/* Actions */}
                  <View style={{ gap: 10, marginTop: 8 }}>
                    <Button
                      title={t('getDirections')}
                      icon={<MaterialCommunityIcons name="navigation" size={18} color={palette.onPrimary} />}
                      onPress={() => {
                        const targetCode = selectedRoom.code;
                        setSelectedRoom(null);
                        router.push({ pathname: '/(tabs)/navigate', params: { to: `room:${targetCode}`, toLabel: targetCode } });
                      }}
                    />
                    <Button
                      title={t('close')}
                      variant="outline"
                      onPress={() => setSelectedRoom(null)}
                    />
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
  },
  viewToggle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    width: 80,
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tableHeader: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E9DF',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E9DF',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '85%',
    padding: 20,
    gap: 12,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CADCBC',
    alignSelf: 'center',
    marginBottom: 8,
  },
  statusBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  equipGrid: {
    gap: 10,
  },
  equipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  scheduleTime: {
    width: 55,
    alignItems: 'flex-start',
  },
});
