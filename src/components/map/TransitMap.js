// Map wrapper that renders the polyline plus vehicle and stop markers.

import React from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import normaliseColor from '../../utils/normaliseColor.js';
import VehicleMarkers from './VehicleMarkers.js';
import StopMarkers from './StopMarkers.js';

/** Wraps MapView and wires together shapes, vehicle markers, and stop markers. */
export default function TransitMap({
  mapRef,
  initialRegion,
  customMapStyle,
  selectedRoute,
  selectedDirectionId,
  selectedShapeCoordinates,
  routesById,
  vehicles,
  staleVehicles,
  selectedVehicleId,
  onVehicleSelect,
  visibleStops,
  selectedStopId,
  onStopSelect,
  onPress,
  onRegionChange
}) {
  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      showsCompass={false}
      showsUserLocation
      showsMyLocationButton={false}
      customMapStyle={customMapStyle}
      provider="google"
      onPress={onPress}
      onRegionChangeComplete={onRegionChange}
    >
      {selectedShapeCoordinates ? (
        <Polyline
          coordinates={selectedShapeCoordinates}
          strokeWidth={4}
          strokeColor={normaliseColor(selectedRoute?.route_color, '#FF9900')}
        />
      ) : null}

      <VehicleMarkers
        vehicles={
          (
            selectedRoute?.route_id
              ? vehicles.filter((vehicle) => {
                  if (vehicle.routeId !== selectedRoute.route_id) return false;
                  if (typeof selectedDirectionId === 'number') {
                    return vehicle.directionId === selectedDirectionId;
                  }
                  return true;
                })
              : vehicles
          )
            // Deduplicate by vehicleId
            .filter((v, index, arr) =>
              index === arr.findIndex(v2 => v2.vehicleId === v.vehicleId)
            )
        }
        routesById={routesById}
        staleVehicles={staleVehicles}
        selectedVehicleId={selectedVehicleId}
        onSelect={onVehicleSelect}
      />

      <StopMarkers stops={visibleStops} selectedStopId={selectedStopId} onSelect={onStopSelect} />
    </MapView>
  );
}
