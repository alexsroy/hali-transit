// Main screen that composes data hooks, map, and sheet UI for the transit experience.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import styles from '../styles/AppStyles.js';
import DARK_MAP_STYLE from '../styles/darkMapStyles.js';
import resolveApiBaseUrl from '../utils/resolveApiBaseUrl.js';
import {
  HALIFAX_REGION,
  REFRESH_INTERVAL_MS,
  STALE_THRESHOLD_MS,
  STOP_PADDING_FACTOR,
  STOP_VISIBILITY_DELTA
} from '../constants/transit.js';
import TransitMap from '../components/map/TransitMap.js';
import TripPlannerSheet from '../components/sheet/TripPlannerSheet.js';
import LoadingOverlay from '../components/common/LoadingOverlay.js';
import StatusBanner from '../components/common/StatusBanner.js';
import useStaticSummary from '../hooks/useStaticSummary.js';
import useRealtimeVehicles from '../hooks/useRealtimeVehicles.js';
import useUserLocation from '../hooks/useUserLocation.js';
import useShapeCoordinates from '../hooks/useShapeCoordinates.js';
import useStopVisibility from '../hooks/useStopVisibility.js';
import useVehicleSelection from '../hooks/useVehicleSelection.js';
import useSelectedStop from '../hooks/useSelectedStop.js';
import useStaleVehicles from '../hooks/useStaleVehicles.js';
import useVisibleStopsList from '../hooks/useVisibleStopsList.js';
import useRouteCards from '../hooks/useRouteCards.js';
import useStopSchedule from '../hooks/useStopSchedule.js';
import useStatusBannerMessage from '../hooks/useStatusBannerMessage.js';

const API_BASE_URL = resolveApiBaseUrl();

/** Main screen responsible for orchestrating map + drawer UI and data hooks. */
export default function TransitScreen() {
  const [selectedStopId, setSelectedStopId] = useState(null);
  const mapRef = useRef(null);
  const sheetRef = useRef(null);

  const {
    routes,
    stops,
    trips,
    loading: loadingStatic,
    error: staticError
  } = useStaticSummary(API_BASE_URL);
  const { vehicles, error: realtimeError } = useRealtimeVehicles(
    API_BASE_URL,
    REFRESH_INTERVAL_MS
  );
  const { userLocation, error: locationError } = useUserLocation();

  const routesById = useMemo(() => new Map(routes.map((route) => [route.route_id, route])), [routes]);
  const stopsById = useMemo(() => new Map(stops.map((stop) => [stop.stop_id, stop])), [stops]);
  const tripsById = useMemo(() => new Map(trips.map((trip) => [trip.trip_id, trip])), [trips]);

  const { selectedVehicleId, setSelectedVehicleId, selectedVehicle } = useVehicleSelection(vehicles);

  const selectedTrip = useMemo(() => {
    if (!selectedVehicle?.tripId) {
      return null;
    }
    return tripsById.get(selectedVehicle.tripId) ?? null;
  }, [selectedVehicle, tripsById]);

  const { selectedShapeCoordinates, shapeError } = useShapeCoordinates(
    selectedTrip,
    API_BASE_URL
  );

  const selectedRoute = useMemo(() => {
    if (selectedTrip?.route_id) {
      return routesById.get(selectedTrip.route_id) ?? null;
    }
    if (selectedVehicle?.routeId) {
      return routesById.get(selectedVehicle.routeId) ?? null;
    }
    return null;
  }, [routesById, selectedTrip, selectedVehicle]);

  const { showStops, visibleRegion, handleRegionChange } = useStopVisibility(
    HALIFAX_REGION,
    STOP_VISIBILITY_DELTA
  );

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

  const staleVehicles = useStaleVehicles(vehicles, STALE_THRESHOLD_MS);
  const visibleStops = useVisibleStopsList({
    showStops,
    stops,
    visibleRegion,
    fallbackRegion: HALIFAX_REGION,
    paddingFactor: STOP_PADDING_FACTOR
  });
  const { selectedStop } = useSelectedStop(selectedStopId, selectedVehicle, stopsById);
  const routeCards = useRouteCards({
    vehicles,
    routes,
    routesById,
    stopsById,
    tripsById,
    staleVehicles
  });
  const { scheduledArrivals } = useStopSchedule(selectedStopId, API_BASE_URL);

  const isStopFocused = Boolean(selectedStopId && selectedStop);
  const activeRouteId = useMemo(
    () => selectedRoute?.route_id ?? selectedVehicle?.routeId ?? null,
    [selectedRoute, selectedVehicle]
  );

  /** Clears any selected stop and collapses the drawer state. */
  const clearStopFocus = useCallback(() => setSelectedStopId(null), []);

  /** Handles selecting a new vehicle from route cards or markers. */
  const handleVehicleSelect = useCallback((vehicleId) => {
    if (!vehicleId) {
      return;
    }
    setSelectedStopId(null);
    setSelectedVehicleId(vehicleId);
  }, [setSelectedVehicleId]);

  /** Handles tapping a stop marker by focusing its details. */
  const handleStopSelect = useCallback((stopId) => {
    setSelectedVehicleId(null);
    setSelectedStopId(stopId);
  }, [setSelectedVehicleId]);

  /** Handles tapping a route card by focusing its vehicle. */
  const handleRouteSelect = useCallback((vehicleId) => {
    if (!vehicleId) {
      return;
    }
    setSelectedStopId(null);
    setSelectedVehicleId(vehicleId);
  }, [setSelectedVehicleId]);

  const handleSearchPress = useCallback(() => {
    sheetRef.current?.expand();
  }, []);

  const statusBanner = useStatusBannerMessage({ staticError, realtimeError, locationError });

  return (
    <View style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.topSearchOverlay}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.searchBar}
            onPress={handleSearchPress}
          >
            <Ionicons name="search" size={20} color="#daf6db" />
            <Text style={styles.searchInput}>Where to?</Text>
          </TouchableOpacity>
        </View>
        <TransitMap
          mapRef={mapRef}
          initialRegion={HALIFAX_REGION}
          customMapStyle={DARK_MAP_STYLE}
          selectedRoute={selectedRoute}
          selectedShapeCoordinates={selectedShapeCoordinates}
          routesById={routesById}
          vehicles={vehicles}
          staleVehicles={staleVehicles}
          selectedVehicleId={selectedVehicleId}
          onVehicleSelect={handleVehicleSelect}
          visibleStops={visibleStops}
          selectedStopId={selectedStopId}
          onStopSelect={handleStopSelect}
          onPress={clearStopFocus}
          onRegionChange={handleRegionChange}
        />

        {loadingStatic ? <LoadingOverlay message="Loading GTFS data…" /> : null}
        <StatusBanner message={statusBanner} />

        <TripPlannerSheet
          ref={sheetRef}
          routeCards={routeCards}
          onRouteSelect={handleRouteSelect}
          activeRouteId={activeRouteId}
          scheduledArrivals={scheduledArrivals}
          isStopFocused={isStopFocused}
          selectedStop={selectedStop}
          selectedStopId={selectedStopId}
          onClearStop={clearStopFocus}
          shapeError={shapeError}
        />
      </View>
    </View>
  );
}
