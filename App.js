import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './src/styles/AppStyles.js';
import DARK_MAP_STYLE from './src/styles/darkMapStyles.js'
import * as Location from 'expo-location';
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
import resolveApiBaseUrl from './src/utils/resolveApiBaseUrl';
import normaliseColor from './src/utils/normaliseColor';
import isFiniteNumber from './src/utils/isFiniteNumber';
import formatTime from './src/utils/formatTime';
import clamp from './src/utils/clamp';
import estimateEtaMinutes from './src/utils/estimateEtaMinutes';
import estimateEtaToStop from './src/utils/estimateEtaToStop';
import haversineDistanceKm from './src/utils/haversineDistanceKm';
import formatRelativeTime from './src/utils/formatRelativeTime';

const HALIFAX_REGION = {
  latitude: 44.6488,
  longitude: -63.5752,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15
};

const REFRESH_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 45_000;

const WINDOW_HEIGHT = Dimensions.get('window').height;
const BASE_EXPANDED_DRAWER_TRANSLATE = Platform.select({ ios: 90, android: 110, default: 100 });
const DEFAULT_COLLAPSED_DRAWER_TRANSLATE = Platform.select({ ios: 300, android: 320, default: 300 });
const MAX_DRAWER_COVERAGE = 0.9;
const MIN_TOP_GAP = WINDOW_HEIGHT * (1 - MAX_DRAWER_COVERAGE);

const API_BASE_URL = resolveApiBaseUrl();

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [stops, setStops] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [selectedStopId, setSelectedStopId] = useState(null);
  const [loadingStatic, setLoadingStatic] = useState(true);
  const [staticError, setStaticError] = useState(null);
  const [realtimeError, setRealtimeError] = useState(null);
  const [shapeCache, setShapeCache] = useState(() => new Map());
  const [shapeError, setShapeError] = useState(null);
  const [sheetHeight, setSheetHeight] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const drawerTranslateY = useRef(new Animated.Value(DEFAULT_COLLAPSED_DRAWER_TRANSLATE)).current;
  const drawerValueRef = useRef(DEFAULT_COLLAPSED_DRAWER_TRANSLATE);
  const hasPositionedSheet = useRef(false);
  const mapRef = useRef(null);

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
    let cancelled = false;

    const requestLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          throw new Error('Location permission denied');
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });
        if (cancelled) {
          return;
        }
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setLocationError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Unable to fetch user location', error);
        setLocationError(error.message);
      }
    };

    requestLocation();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userLocation || !mapRef.current) {
      return;
    }
    mapRef.current.animateCamera(
      {
        center: userLocation,
        zoom: 14
      },
      { duration: 800 }
    );
  }, [userLocation]);

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

  const activeStopId = selectedStopId ?? selectedVehicle?.stopId ?? null;

  const selectedStop = useMemo(() => {
    if (!activeStopId) {
      return null;
    }
    return stopsById.get(activeStopId) ?? null;
  }, [activeStopId, stopsById]);

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
    if (locationError) {
      return 'Location unavailable. Enable permissions to center on you.';
    }
    return null;
  })();

  const activeRouteId = useMemo(
    () => selectedRoute?.route_id ?? selectedVehicle?.routeId ?? null,
    [selectedRoute, selectedVehicle]
  );

  const expandedDrawerTranslate = useMemo(
    () => Math.max(BASE_EXPANDED_DRAWER_TRANSLATE, MIN_TOP_GAP),
    []
  );

  const collapsedDrawerTranslate = useMemo(() => {
    if (!sheetHeight) {
      return DEFAULT_COLLAPSED_DRAWER_TRANSLATE;
    }
    const visibleTarget = WINDOW_HEIGHT * 0.33;
    const translate = sheetHeight - visibleTarget;
    return clamp(
      translate,
      expandedDrawerTranslate,
      Math.max(sheetHeight, DEFAULT_COLLAPSED_DRAWER_TRANSLATE)
    );
  }, [expandedDrawerTranslate, sheetHeight]);

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
          expandedDrawerTranslate,
          collapsedDrawerTranslate
        );
        drawerTranslateY.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const midpoint = (expandedDrawerTranslate + collapsedDrawerTranslate) / 2;
        const shouldExpand =
          gesture.vy < -0.2
            ? true
            : gesture.vy > 0.2
            ? false
            : drawerValueRef.current < midpoint;
        animateDrawer(shouldExpand ? expandedDrawerTranslate : collapsedDrawerTranslate);
      }
    });
  }, [animateDrawer, collapsedDrawerTranslate, drawerTranslateY, expandedDrawerTranslate]);

  useEffect(() => {
    if (selectedStopId) {
      animateDrawer(expandedDrawerTranslate);
    }
  }, [animateDrawer, expandedDrawerTranslate, selectedStopId]);

  const routeCards = useMemo(() => {
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
      const etaMinutes = estimateEtaMinutes(vehicle.timestampMs);
      items.push({
        id: key,
        routeId: route?.route_id ?? vehicle.routeId ?? null,
        routeLabel:
          route?.route_short_name ?? route?.route_long_name ?? vehicle.routeId ?? 'Route',
        headsign: trip?.trip_headsign ?? route?.route_long_name ?? 'Headsign unavailable',
        stopLabel: stop?.stop_name ?? 'Stop info coming soon',
        etaMinutes,
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

  const stopArrivals = useMemo(() => {
    if (!selectedStopId || !selectedStop) {
      return [];
    }
    return vehicles
      .map((vehicle) => {
        const distanceKm = haversineDistanceKm(
          vehicle.latitude,
          vehicle.longitude,
          Number(selectedStop.stop_lat),
          Number(selectedStop.stop_lon)
        );
        if (!Number.isFinite(distanceKm)) {
          return null;
        }
        const route = vehicle.routeId ? routesById.get(vehicle.routeId) : null;
        const trip = vehicle.tripId ? tripsById.get(vehicle.tripId) : null;
        const etaMinutes = estimateEtaToStop(distanceKm, vehicle.speed);
        return {
          id: vehicle.id,
          routeLabel:
            route?.route_short_name ?? route?.route_long_name ?? vehicle.routeId ?? 'Route',
          headsign: trip?.trip_headsign ?? 'Inbound service',
          etaMinutes,
          timestamp: vehicle.timestamp,
          distanceLabel:
            distanceKm < 1
              ? `${(distanceKm * 1000).toFixed(0)} m away`
              : `${distanceKm.toFixed(1)} km away`,
          isStale: staleVehicles.has(vehicle.id)
        };
      })
      .filter((item) => item && item.etaMinutes !== null && item.etaMinutes < 120)
      .sort((a, b) => (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity));
  }, [routesById, selectedStop, selectedStopId, staleVehicles, tripsById, vehicles]);

  const isStopFocused = Boolean(selectedStopId && selectedStop);

  const clearStopFocus = useCallback(() => setSelectedStopId(null), []);

  const renderRouteCard = useCallback(
    ({ item }) => {
      const isActive = Boolean(activeRouteId && item.routeId === activeRouteId);
      return (
        <TouchableOpacity
          style={[styles.routeCard, isActive && styles.routeCardActive]}
          activeOpacity={0.85}
          onPress={() => {
            if (item.vehicleId) {
              setSelectedStopId(null);
              setSelectedVehicleId(item.vehicleId);
            }
          }}
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
            {item.updatedLabel ? <Text style={styles.routeUpdated}>{item.updatedLabel}</Text> : null}
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
    },
    [activeRouteId]
  );

  const renderStopArrival = useCallback(({ item }) => (
    <View style={styles.arrivalCard}>
      <View style={styles.arrivalRouteBadge}>
        <Text style={styles.arrivalRouteText}>{item.routeLabel}</Text>
      </View>
      <View style={styles.arrivalBody}>
        <Text style={styles.arrivalTitle} numberOfLines={1}>
          {item.headsign}
        </Text>
        <Text style={styles.arrivalSubtitle}>
          {item.distanceLabel} · updated {item.timestamp ? formatTime(item.timestamp) : 'recently'}
        </Text>
      </View>
      <View style={styles.arrivalEtaBlock}>
        <Text style={styles.arrivalEta}>{item.etaMinutes ? `${item.etaMinutes}` : '—'}</Text>
        <Text style={styles.arrivalEtaCaption}>min</Text>
      </View>
    </View>
  ), []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={HALIFAX_REGION}
          showsCompass={false}
          showsUserLocation
          showsMyLocationButton={false}
          customMapStyle={DARK_MAP_STYLE}
          provider="google"
          onPress={clearStopFocus}
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
                onPress={() => {
                  setSelectedStopId(null);
                  setSelectedVehicleId(vehicle.id);
                }}
              >
                <View style={styles.markerLabel}>
                  <Text style={styles.markerText}>{displayLabel}</Text>
                </View>
              </Marker>
            );
          })}

          {stops.map((stop) => {
            const latitude = Number(stop.stop_lat);
            const longitude = Number(stop.stop_lon);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              return null;
            }
            const isFocused = selectedStopId === stop.stop_id;
            return (
              <Marker
                key={`stop-${stop.stop_id}`}
                coordinate={{ latitude, longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={(event) => {
                  event.stopPropagation();
                  setSelectedVehicleId(null);
                  setSelectedStopId(stop.stop_id);
                }}
              >
                <View style={[styles.stopDot, isFocused && styles.stopDotActive]} />
              </Marker>
            );
          })}
        </MapView>

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
              onPress={() => animateDrawer(expandedDrawerTranslate)}
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

          {isStopFocused ? (
            <>
              <View style={styles.stopHeader}>
                <View>
                  <Text style={styles.stopTitle}>{selectedStop?.stop_name ?? 'Stop'}</Text>
                  <Text style={styles.stopSubtitle}>
                    Stop #{selectedStop?.stop_id ?? selectedStopId}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel="Close stop details"
                  onPress={clearStopFocus}
                  style={styles.stopCloseButton}
                >
                  <Ionicons name="close" size={18} color="#0a2239" />
                </TouchableOpacity>
              </View>
              <FlatList
                data={stopArrivals}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.routesList}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyTitle}>No buses approaching</Text>
                    <Text style={styles.emptySubtitle}>
                      We will post arrivals here as soon as vehicles report this stop.
                    </Text>
                  </View>
                }
                renderItem={renderStopArrival}
              />
            </>
          ) : (
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
              renderItem={renderRouteCard}
            />
          )}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}
