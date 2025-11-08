import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  PanResponder,
  Platform,
  SafeAreaView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Text,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const HALIFAX_REGION = {
  latitude: 44.6488,
  longitude: -63.5752,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15
};

const REFRESH_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 45_000;

const WINDOW_HEIGHT = Dimensions.get('window').height;
const EXPANDED_DRAWER_TRANSLATE = Platform.select({ ios: 90, android: 110, default: 100 });
const DEFAULT_COLLAPSED_DRAWER_TRANSLATE = Platform.select({ ios: 300, android: 320, default: 300 });

const API_BASE_URL = resolveApiBaseUrl();

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [stops, setStops] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [loadingStatic, setLoadingStatic] = useState(true);
  const [staticError, setStaticError] = useState(null);
  const [realtimeError, setRealtimeError] = useState(null);
  const [shapeCache, setShapeCache] = useState(() => new Map());
  const [shapeError, setShapeError] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [sheetHeight, setSheetHeight] = useState(null);
  const drawerTranslateY = useRef(new Animated.Value(DEFAULT_COLLAPSED_DRAWER_TRANSLATE)).current;
  const drawerValueRef = useRef(DEFAULT_COLLAPSED_DRAWER_TRANSLATE);
  const hasPositionedSheet = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadStaticSummary = async () => {
      setLoadingStatic(true);
      setStaticError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/api/static/summary`);
        if (!response.ok) {
          throw new Error(`Static summary request failed (${response.status})`);
        }
        const data = await response.json();
        if (!cancelled) {
          setRoutes(data.routes ?? []);
          setStops(data.stops ?? []);
          setTrips(data.trips ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load static GTFS summary', error);
          setStaticError(error.message);
        }
      } finally {
        if (!cancelled) {
          setLoadingStatic(false);
        }
      }
    };

    loadStaticSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();

    const fetchVehicles = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/realtime/vehicles`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Realtime vehicles request failed (${response.status})`);
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        const nowVehicles = (payload.vehicles ?? [])
          .filter((vehicle) => isFiniteNumber(vehicle.position?.latitude) && isFiniteNumber(vehicle.position?.longitude))
          .map((vehicle) => {
            const timestampMs = vehicle.timestamp ? Date.parse(vehicle.timestamp) : null;
            return {
              id: vehicle.vehicleId || vehicle.entityId || `vehicle-${vehicle.routeId ?? 'unknown'}`,
              routeId: vehicle.routeId ?? null,
              tripId: vehicle.tripId ?? null,
              directionId: vehicle.directionId ?? null,
              latitude: Number(vehicle.position.latitude),
              longitude: Number(vehicle.position.longitude),
              bearing: vehicle.position.bearing ?? null,
              speed: vehicle.position.speed ?? null,
              timestamp: vehicle.timestamp ?? null,
              timestampMs,
              currentStopSequence: vehicle.currentStopSequence ?? null,
              stopId: vehicle.stopId ?? null,
              congestionLevel: vehicle.congestionLevel ?? null,
              scheduleRelationship: vehicle.scheduleRelationship ?? null,
              label: vehicle.label ?? null,
              licensePlate: vehicle.licensePlate ?? null
            };
          });

        setVehicles(nowVehicles);
        setRealtimeError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error.name === 'AbortError') {
          return;
        }
        console.error('Failed to load realtime vehicles', error);
        setRealtimeError(error.message);
      }
    };

    fetchVehicles();
    const interval = setInterval(() => {
      controller.abort();
      controller = new AbortController();
      fetchVehicles();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (vehicles.length === 0) {
      setSelectedVehicleId(null);
      return;
    }

    setSelectedVehicleId((currentId) => {
      if (currentId && vehicles.some((vehicle) => vehicle.id === currentId)) {
        return currentId;
      }
      return vehicles[0].id;
    });
  }, [vehicles]);

  const routesById = useMemo(
    () => new Map(routes.map((route) => [route.route_id, route])),
    [routes]
  );

  const stopsById = useMemo(
    () => new Map(stops.map((stop) => [stop.stop_id, stop])),
    [stops]
  );

  const tripsById = useMemo(
    () => new Map(trips.map((trip) => [trip.trip_id, trip])),
    [trips]
  );

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId]
  );

  const selectedTrip = useMemo(() => {
    if (!selectedVehicle?.tripId) {
      return null;
    }
    return tripsById.get(selectedVehicle.tripId) ?? null;
  }, [selectedVehicle, tripsById]);

  const selectedRoute = useMemo(() => {
    if (selectedTrip?.route_id) {
      return routesById.get(selectedTrip.route_id) ?? null;
    }
    if (selectedVehicle?.routeId) {
      return routesById.get(selectedVehicle.routeId) ?? null;
    }
    return null;
  }, [routesById, selectedTrip, selectedVehicle]);

  const selectedStop = useMemo(() => {
    if (!selectedVehicle?.stopId) {
      return null;
    }
    return stopsById.get(selectedVehicle.stopId) ?? null;
  }, [selectedVehicle, stopsById]);

  useEffect(() => {
    const shapeId = selectedTrip?.shape_id;
    if (!shapeId || shapeCache.has(shapeId)) {
      return;
    }

    let cancelled = false;

    const fetchShape = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/static/shape?shapeId=${encodeURIComponent(shapeId)}`
        );
        if (!response.ok) {
          throw new Error(`Shape request failed (${response.status})`);
        }

        const data = await response.json();
        if (cancelled) {
          return;
        }

        const coordinates = (data.points ?? [])
          .filter(
            (point) =>
              isFiniteNumber(point.shape_pt_lat) && isFiniteNumber(point.shape_pt_lon)
          )
          .map((point) => ({
            latitude: Number(point.shape_pt_lat),
            longitude: Number(point.shape_pt_lon)
          }));

        setShapeCache((previous) => {
          if (previous.has(shapeId)) {
            return previous;
          }
          const next = new Map(previous);
          next.set(shapeId, coordinates);
          return next;
        });
        setShapeError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Failed to load shape data', error);
        setShapeError(error.message);
      }
    };

    fetchShape();

    return () => {
      cancelled = true;
    };
  }, [selectedTrip, shapeCache]);

  const selectedShapeCoordinates = useMemo(() => {
    const shapeId = selectedTrip?.shape_id;
    if (!shapeId) {
      return null;
    }
    return shapeCache.get(shapeId) ?? null;
  }, [shapeCache, selectedTrip]);

  const staleVehicles = useMemo(() => {
    const now = Date.now();
    return new Set(
      vehicles
        .filter(
          (vehicle) =>
            typeof vehicle.timestampMs === 'number' &&
            now - vehicle.timestampMs > STALE_THRESHOLD_MS
        )
        .map((vehicle) => vehicle.id)
    );
  }, [vehicles]);

  const statusBanner = (() => {
    if (staticError) {
      return 'Static GTFS data unavailable. Check backend.';
    }
    if (realtimeError) {
      return 'Realtime feed unreachable. Showing last known locations.';
    }
    return null;
  })();

  const timeLabel = useMemo(
    () => now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [now]
  );

  const activeRouteId = useMemo(
    () => selectedRoute?.route_id ?? selectedVehicle?.routeId ?? null,
    [selectedRoute, selectedVehicle]
  );

  const collapsedDrawerTranslate = useMemo(() => {
    if (!sheetHeight) {
      return DEFAULT_COLLAPSED_DRAWER_TRANSLATE;
    }
    const visibleTarget = WINDOW_HEIGHT * 0.33;
    const translate = sheetHeight - visibleTarget;
    return clamp(
      translate,
      EXPANDED_DRAWER_TRANSLATE,
      Math.max(sheetHeight, DEFAULT_COLLAPSED_DRAWER_TRANSLATE)
    );
  }, [sheetHeight]);

  useEffect(() => {
    if (!sheetHeight || hasPositionedSheet.current) {
      return;
    }
    hasPositionedSheet.current = true;
    drawerTranslateY.setValue(collapsedDrawerTranslate);
  }, [collapsedDrawerTranslate, drawerTranslateY, sheetHeight]);

  useEffect(() => {
    const id = drawerTranslateY.addListener(({ value }) => {
      drawerValueRef.current = value;
    });
    return () => drawerTranslateY.removeListener(id);
  }, [drawerTranslateY]);

  const animateDrawer = useCallback(
    (toValue) => {
      Animated.spring(drawerTranslateY, {
        toValue,
        useNativeDriver: true,
        damping: 25,
        stiffness: 220,
        mass: 0.9
      }).start();
    },
    [drawerTranslateY]
  );

  const sheetPanResponder = useMemo(() => {
    let dragOrigin = collapsedDrawerTranslate;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => {
        dragOrigin = drawerValueRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const next = clamp(
          dragOrigin + gesture.dy,
          EXPANDED_DRAWER_TRANSLATE,
          collapsedDrawerTranslate
        );
        drawerTranslateY.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const midpoint = (EXPANDED_DRAWER_TRANSLATE + collapsedDrawerTranslate) / 2;
        const shouldExpand =
          gesture.vy < -0.2
            ? true
            : gesture.vy > 0.2
            ? false
            : drawerValueRef.current < midpoint;
        animateDrawer(shouldExpand ? EXPANDED_DRAWER_TRANSLATE : collapsedDrawerTranslate);
      }
    });
  }, [animateDrawer, collapsedDrawerTranslate, drawerTranslateY]);

  const routeCards = useMemo(() => {
    const nowMs = Date.now();
    const items = [];
    const seen = new Set();

    vehicles.forEach((vehicle) => {
      const route = vehicle.routeId ? routesById.get(vehicle.routeId) : null;
      const trip = vehicle.tripId ? tripsById.get(vehicle.tripId) : null;
      const stop = vehicle.stopId ? stopsById.get(vehicle.stopId) : null;
      const key = route?.route_id ?? vehicle.routeId ?? vehicle.id;
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push({
        id: key,
        routeId: route?.route_id ?? vehicle.routeId ?? null,
        routeLabel:
          route?.route_short_name ?? route?.route_long_name ?? vehicle.routeId ?? 'Route',
        headsign: trip?.trip_headsign ?? route?.route_long_name ?? 'Headsign unavailable',
        stopLabel: stop?.stop_name ?? 'Stop info coming soon',
        etaMinutes: vehicle.timestampMs
          ? Math.max(1, 5 + Math.round((nowMs - vehicle.timestampMs) / 60000))
          : null,
        warning: vehicle.congestionLevel === 'severe' ? 'Delayed' : null,
        vehicleId: vehicle.id,
        isStale: staleVehicles.has(vehicle.id),
        updatedLabel: vehicle.timestampMs ? formatRelativeTime(vehicle.timestampMs) : null
      });
    });

    if (items.length === 0) {
      return routes.slice(0, 5).map((route, index) => ({
        id: route.route_id ?? `route-${index}`,
        routeId: route.route_id ?? null,
        routeLabel: route.route_short_name ?? route.route_long_name ?? `Route ${index + 1}`,
        headsign: route.route_long_name ?? 'Service info pending',
        stopLabel: 'Searching nearby stops…',
        etaMinutes: null,
        warning: null,
        vehicleId: null,
        isStale: false,
        updatedLabel: null
      }));
    }

    return items.slice(0, 5);
  }, [routes, routesById, staleVehicles, stopsById, tripsById, vehicles]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={HALIFAX_REGION}
          showsCompass={false}
          showsMyLocationButton={false}
          customMapStyle={DARK_MAP_STYLE}
          provider="google"
        >
          {selectedShapeCoordinates ? (
            <Polyline
              coordinates={selectedShapeCoordinates}
              strokeWidth={4}
              strokeColor={normaliseColor(selectedRoute?.route_color, '#FF9900')}
            />
          ) : null}

          {vehicles.map((vehicle) => {
            const route = vehicle.routeId ? routesById.get(vehicle.routeId) : null;
            const displayLabel =
              route?.route_short_name ?? vehicle.routeId ?? vehicle.label ?? 'Bus';
            const isSelected = vehicle.id === selectedVehicleId;

            return (
              <Marker
                key={vehicle.id}
                coordinate={{
                  latitude: vehicle.latitude,
                  longitude: vehicle.longitude
                }}
                pinColor={isSelected ? '#FF9900' : '#00558C'}
                opacity={staleVehicles.has(vehicle.id) ? 0.5 : 1}
                onPress={() => setSelectedVehicleId(vehicle.id)}
              >
                <View style={styles.markerLabel}>
                  <Text style={styles.markerText}>{displayLabel}</Text>
                </View>
              </Marker>
            );
          })}
        </MapView>

        <View style={styles.timeOverlay}>
          <Text style={styles.timeText}>{timeLabel}</Text>
          <Ionicons name="navigate" color="#6bd3ff" size={18} style={styles.timeIcon} />
        </View>

        {loadingStatic ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={styles.loadingText}>Loading GTFS data…</Text>
          </View>
        ) : null}

        {statusBanner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{statusBanner}</Text>
          </View>
        ) : null}

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: drawerTranslateY }] }]}
          onLayout={({ nativeEvent }) => setSheetHeight(nativeEvent.layout.height)}
        >
          <View style={styles.sheetHandleArea} {...sheetPanResponder.panHandlers}>
            <View style={styles.sheetHandle} />
          </View>
          <Text style={styles.sheetTitle}>Plan your trip</Text>
          <View style={styles.sheetHeaderRow}>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.searchBar}
              onPress={() => animateDrawer(EXPANDED_DRAWER_TRANSLATE)}
            >
              <Ionicons name="search" size={20} color="#daf6db" />
              <TextInput
                placeholder="Where to?"
                placeholderTextColor="#daf6db"
                style={styles.searchInput}
                editable={false}
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.homeButton} activeOpacity={0.8}>
              <Ionicons name="home" size={20} color="#0a2239" />
              <Ionicons name="add" size={16} color="#0a2239" style={styles.homeButtonIcon} />
            </TouchableOpacity>
          </View>

          {shapeError ? (
            <Text style={styles.sheetWarning}>Unable to load route shape: {shapeError}</Text>
          ) : null}

          <FlatList
            data={routeCards}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.routesList}
            ItemSeparatorComponent={() => <View style={styles.routeDivider} />}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>Nearby routes</Text>
                <Text style={styles.listSubtitle}>Live arrivals refresh every few seconds.</Text>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No buses to show</Text>
                <Text style={styles.emptySubtitle}>
                  We will list service here as soon as the realtime feed reports vehicles.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isActive = Boolean(activeRouteId && item.routeId === activeRouteId);
              return (
                <TouchableOpacity
                  style={[styles.routeCard, isActive && styles.routeCardActive]}
                  activeOpacity={0.85}
                  onPress={() => item.vehicleId && setSelectedVehicleId(item.vehicleId)}
                >
                  <View style={styles.routeBadgeColumn}>
                    <Text style={[styles.routeBadgeText, isActive && styles.routeBadgeTextActive]}>
                      {item.routeLabel}
                    </Text>
                    {item.warning ? (
                      <MaterialCommunityIcons
                        name="alert-circle"
                        size={16}
                        color="#ffdd55"
                        style={styles.routeWarningIcon}
                      />
                    ) : null}
                  </View>
                  <View style={styles.routeBody}>
                    <Text style={styles.routeTitle} numberOfLines={1}>
                      {item.headsign}
                    </Text>
                    <Text style={styles.routeSubtitle} numberOfLines={1}>
                      {item.stopLabel}
                    </Text>
                    {item.updatedLabel ? (
                      <Text style={styles.routeUpdated}>{item.updatedLabel}</Text>
                    ) : null}
                  </View>
                  <View style={styles.routeMeta}>
                    <Text style={[styles.etaText, isActive && styles.etaTextActive]}>
                      {item.etaMinutes ? `${item.etaMinutes}` : '—'}
                    </Text>
                    <Text style={styles.etaCaption}>minutes</Text>
                    <MaterialCommunityIcons
                      name="access-point"
                      size={18}
                      color={item.isStale ? '#7a8fa6' : '#77f0ff'}
                    />
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

function resolveApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) {
      return `http://${host}:4000`;
    }
  }

  return 'http://localhost:4000';
}

function normaliseColor(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value.startsWith('#') ? value : `#${value}`;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatTime(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'unavailable';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return 'unavailable';
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatRelativeTime(timestampMs) {
  if (typeof timestampMs !== 'number') {
    return null;
  }
  const diff = Date.now() - timestampMs;
  if (diff < 0) {
    return 'just now';
  }
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a2239'
  },
  container: {
    flex: 1,
    backgroundColor: '#0a2239'
  },
  timeOverlay: {
    position: 'absolute',
    top: Platform.select({ ios: 12, android: 16 }),
    left: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 34, 57, 0.85)',
    flexDirection: 'row',
    alignItems: 'center'
  },
  timeText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600'
  },
  timeIcon: {
    marginLeft: 8
  },
  markerLabel: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderColor: '#0a2239',
    borderWidth: StyleSheet.hairlineWidth
  },
  markerText: {
    color: '#0a2239',
    fontWeight: '700',
    fontSize: 12
  },
  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 34, 57, 0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: {
    marginTop: 8,
    color: '#ffffff',
    fontSize: 14
  },
  banner: {
    position: 'absolute',
    top: Platform.select({ ios: 12, android: 12 }),
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 136, 0, 0.95)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12
  },
  bannerText: {
    color: '#0a2239',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -20,
    backgroundColor: '#08122c',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 4,
    paddingHorizontal: 20,
    paddingBottom: 32,
    minHeight: 360,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingVertical: 6
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#2f3f66',
    alignSelf: 'center',
    marginBottom: 12
  },
  sheetTitle: {
    color: '#8aa2c8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  searchBar: {
    flex: 1,
    backgroundColor: '#0c793a',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  searchInput: {
    flex: 1,
    color: '#daf6db',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8
  },
  homeButton: {
    backgroundColor: '#2de1fc',
    borderRadius: 20,
    width: 44,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12
  },
  homeButtonIcon: {
    marginLeft: 4
  },
  sheetWarning: {
    color: '#ffcccb',
    fontSize: 12,
    marginTop: 8
  },
  routesList: {
    paddingTop: 8,
    paddingBottom: 40,
    flexGrow: 1
  },
  listHeader: {
    marginTop: 20,
    marginBottom: 12
  },
  listTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700'
  },
  listSubtitle: {
    color: '#7a8fa6',
    fontSize: 12,
    marginTop: 4
  },
  routeCard: {
    backgroundColor: '#0f1f3f',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 96
  },
  routeCardActive: {
    backgroundColor: '#122554',
    borderColor: '#2de1fc',
    borderWidth: 1
  },
  routeBadgeColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  routeBadgeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#8ed0ff'
  },
  routeBadgeTextActive: {
    color: '#ffffff'
  },
  routeBody: {
    flex: 1
  },
  routeTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2
  },
  routeSubtitle: {
    color: '#8aa2c8',
    fontSize: 13
  },
  routeUpdated: {
    color: '#5f7397',
    fontSize: 11,
    marginTop: 6
  },
  routeMeta: {
    alignItems: 'flex-end',
    marginLeft: 8
  },
  etaText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800'
  },
  etaTextActive: {
    color: '#2de1fc'
  },
  etaCaption: {
    color: '#7a8fa6',
    fontSize: 11,
    marginBottom: 4
  },
  routeWarningIcon: {
    marginTop: 2
  },
  routeDivider: {
    height: 12
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32
  },
  emptyTitle: {
    color: '#f3f6ff',
    fontSize: 16,
    fontWeight: '700'
  },
  emptySubtitle: {
    color: '#7a8fa6',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20
  }
});

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#06122a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4d94c2' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#02101f' }] },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#03245b' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#0b2f4e' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#11456f' }]
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }]
  }
];
