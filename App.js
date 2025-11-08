import React, { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

const HALIFAX_REGION = {
  latitude: 44.6488,
  longitude: -63.5752,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15
};

const REFRESH_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 45_000;

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={HALIFAX_REGION}
          showsCompass={false}
          showsMyLocationButton={false}
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

        {selectedVehicle ? (
          <View style={styles.drawer}>
            <Text style={styles.drawerHeading}>
              Route{' '}
              {selectedRoute?.route_short_name ??
                selectedRoute?.route_long_name ??
                selectedVehicle.routeId ??
                'Unknown'}
            </Text>
            <Text style={styles.drawerSubheading}>
              {selectedTrip?.trip_headsign ??
                (typeof selectedVehicle.directionId === 'number'
                  ? `Direction ${selectedVehicle.directionId}`
                  : 'Direction unavailable')}
            </Text>
            <Text style={styles.drawerMeta}>
              Last update:{' '}
              {selectedVehicle.timestamp
                ? formatTime(selectedVehicle.timestamp)
                : 'unavailable'}
            </Text>
            {selectedStop ? (
              <Text style={styles.drawerMeta}>Next stop: {selectedStop.stop_name}</Text>
            ) : null}
            {selectedVehicle.scheduleRelationship ? (
              <Text style={styles.drawerMeta}>
                Schedule: {selectedVehicle.scheduleRelationship.toLowerCase()}
              </Text>
            ) : null}
            {shapeError ? (
              <Text style={styles.drawerWarning}>
                Unable to load route shape: {shapeError}
              </Text>
            ) : null}
            <Text style={styles.drawerHint}>Tap another bus to switch focus.</Text>
          </View>
        ) : null}
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a2239'
  },
  container: {
    flex: 1,
    backgroundColor: '#0a2239'
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
  drawer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.select({ ios: 40, android: 24 }),
    backgroundColor: 'rgba(10, 34, 57, 0.95)',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 3
  },
  drawerHeading: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4
  },
  drawerSubheading: {
    color: '#ffbb33',
    fontSize: 14,
    marginBottom: 8
  },
  drawerMeta: {
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 4
  },
  drawerHint: {
    color: '#b0c4de',
    fontSize: 12,
    marginTop: 8
  },
  drawerWarning: {
    color: '#ffcccb',
    fontSize: 12,
    marginTop: 8
  }
});
