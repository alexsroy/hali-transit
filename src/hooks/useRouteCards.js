// Generates the list of route cards displayed in the trip planner sheet.

import { useMemo } from 'react';
import estimateEtaMinutes from '../utils/estimateEtaMinutes.js';
import formatRelativeTime from '../utils/formatRelativeTime.js';
import haversineDistanceKm from '../utils/haversineDistanceKm.js';
import estimateEtaToStop from '../utils/estimateEtaToStop.js';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeDirection = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const cleanHeadsign = (headsign, routeLabel) => {
  if (!headsign || !routeLabel) {
    return headsign;
  }
  const pattern = new RegExp(`^${escapeRegExp(String(routeLabel).trim())}\\s*[-–:]*\\s*`, 'i');
  const cleaned = headsign.replace(pattern, '').trim();
  return cleaned.length > 0 ? cleaned : headsign;
};

const selectPreferredDirection = (routeId, directionOptions, entries, routeDirections) => {
  const preferredDirection = normalizeDirection(
    routeDirections?.get?.(routeId) ??
      routeDirections?.get?.(String(routeId)) ??
      routeDirections?.get?.(Number(routeId))
  );

  return (
    preferredDirection ??
    (directionOptions.find((opt) => opt.hasRealtime)?.id ??
      directionOptions[0]?.id ??
      entries[0]?.card.directionId ??
      null)
  );
};

const buildDirectionOptions = (routeId, entries, directionLookup) => {
  const options = [];
  const directionMap = routeId ? directionLookup.get(routeId) ?? null : null;
  if (directionMap) {
    directionMap.forEach((label, dirId) => {
      options.push({
        id: dirId,
        label,
        hasRealtime: entries.some((entry) => entry.card.directionId === dirId)
      });
    });
  } else {
    const uniqueDirections = new Set(entries.map((entry) => entry.card.directionId).filter((id) => id !== null));
    if (uniqueDirections.size > 0) {
      uniqueDirections.forEach((dirId) => {
        options.push({
          id: dirId,
          label: `Direction ${dirId}`,
          hasRealtime: true
        });
      });
    }
  }
  return options;
};

const buildDirectionLookup = (tripsById) => {
  const directionLookup = new Map();
  tripsById.forEach((trip) => {
    const dirId = normalizeDirection(trip?.direction_id);
    if (!trip?.route_id || dirId === null) {
      return;
    }
    const routeDirectionsMap = directionLookup.get(trip.route_id) ?? new Map();
    if (!routeDirectionsMap.has(dirId) && trip.trip_headsign) {
      routeDirectionsMap.set(dirId, trip.trip_headsign);
    }
    directionLookup.set(trip.route_id, routeDirectionsMap);
  });
  return directionLookup;
};

const resolveStop = (vehicle, stopsById, stopsNearUser, stopsArray) => {
  const rawStopId = vehicle.stopId ?? null;
  if (rawStopId !== null) {
    const direct =
      stopsById.get(rawStopId) ??
      stopsById.get(String(rawStopId)) ??
      (Number.isFinite(Number(rawStopId)) ? stopsById.get(Number(rawStopId)) : null);
    if (direct) {
      return direct;
    }
  }
  if (!Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) {
    return null;
  }
  const candidateStops =
    stopsNearUser.length > 0 ? stopsNearUser.slice(0, 50).map((entry) => entry.stop) : stopsArray;
  let nearestStop = null;
  let nearestDistance = Infinity;
  for (let i = 0; i < candidateStops.length; i += 1) {
    const candidate = candidateStops[i];
    const dist = haversineDistanceKm(
      vehicle.latitude,
      vehicle.longitude,
      candidate.stop_lat,
      candidate.stop_lon
    );
    if (!Number.isFinite(dist)) {
      continue;
    }
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestStop = candidate;
    }
  }
  return nearestStop;
};

const buildStopsNearUser = (stopsArray, userLocation) => {
  if (!userLocation) {
    return [];
  }
  return stopsArray
    .map((stop) => ({
      stop,
      distanceKm: haversineDistanceKm(
        userLocation.latitude,
        userLocation.longitude,
        stop.stop_lat,
        stop.stop_lon
      )
    }))
    .filter((entry) => Number.isFinite(entry.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm);
};

const buildFallbackRoutes = (routes) =>
  routes.slice(0, MAX_ROUTE_CARDS).map((route, index) => ({
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

/** Builds up to fifteen route cards combining realtime vehicles and static data. */
const MAX_ROUTE_CARDS = 15;

export default function useRouteCards({
  vehicles,
  routes,
  routesById,
  stopsById,
  tripsById,
  staleVehicles,
  userLocation,
  routeDirections
}) {
  return useMemo(() => {
    const directionLookup = buildDirectionLookup(tripsById);

    const stopBuckets = new Map();
    const cardsWithoutLocation = [];
    const stopsArray = Array.from(stopsById.values());
    const stopsNearUser = buildStopsNearUser(stopsArray, userLocation);

    vehicles.forEach((vehicle) => {
      const route = vehicle.routeId ? routesById.get(vehicle.routeId) : null;
      const trip = vehicle.tripId ? tripsById.get(vehicle.tripId) : null;
      const stop = resolveStop(vehicle, stopsById, stopsNearUser, stopsArray);
      const stopKey = stop?.stop_id ?? vehicle.stopId ?? null;
      const key = route?.route_id ?? vehicle.routeId ?? vehicle.id;
      if (!key) {
        return;
      }

      const distanceKm =
        userLocation && stop
          ? haversineDistanceKm(
              userLocation.latitude,
              userLocation.longitude,
              stop.stop_lat,
              stop.stop_lon
            )
          : null;

      const stopDistanceKm =
        stop && Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude)
          ? haversineDistanceKm(vehicle.latitude, vehicle.longitude, stop.stop_lat, stop.stop_lon)
          : null;

      const etaMinutesRaw = Number.isFinite(stopDistanceKm)
        ? estimateEtaToStop(stopDistanceKm, vehicle.speed)
        : estimateEtaMinutes(vehicle.timestampMs);
      const etaMinutes =
        etaMinutesRaw == null ? null : etaMinutesRaw < 1 ? 0 : etaMinutesRaw;

      const routeLabel =
        route?.route_short_name ?? route?.route_long_name ?? vehicle.routeId ?? 'Route';
      const headsignRaw = trip?.trip_headsign ?? route?.route_long_name ?? 'Headsign unavailable';

      const card = {
        id: key,
        routeId: route?.route_id ?? vehicle.routeId ?? null,
        routeLabel,
        headsign: cleanHeadsign(headsignRaw, routeLabel),
        stopLabel: stop?.stop_name ?? (stopKey !== null ? `Stop ${stopKey}` : 'Stop info coming soon'),
        etaMinutes,
        warning: vehicle.congestionLevel === 'severe' ? 'Delayed' : null,
        vehicleId: vehicle.id,
        isStale: staleVehicles.has(vehicle.id),
        updatedLabel: vehicle.timestampMs ? formatRelativeTime(vehicle.timestampMs) : null,
        distanceKm,
        directionId: normalizeDirection(
          typeof vehicle.directionId === 'number' ? vehicle.directionId : trip?.direction_id
        )
      };

      if (Number.isFinite(distanceKm)) {
        const bucketKey = stopKey ?? vehicle.stopId;
        if (!stopBuckets.has(bucketKey)) {
          stopBuckets.set(bucketKey, {
            stopId: bucketKey,
            distanceKm,
            cards: []
          });
        }
        stopBuckets.get(bucketKey).cards.push(card);
      } else {
        cardsWithoutLocation.push(card);
      }
    });

    const sortedBuckets = Array.from(stopBuckets.values()).sort((a, b) => a.distanceKm - b.distanceKm);
    const primaryBuckets = sortedBuckets.slice(0, 4);
    const secondaryBuckets = sortedBuckets.slice(4);

    const primaryCandidates = [];
    primaryBuckets.forEach((bucket) => {
      bucket.cards.forEach((card) =>
        primaryCandidates.push({ card, index: primaryCandidates.length, isPrimary: true })
      );
    });

    const secondaryCandidates = [];
    secondaryBuckets.forEach((bucket) => {
      bucket.cards.forEach((card) =>
        secondaryCandidates.push({
          card,
          index: primaryCandidates.length + secondaryCandidates.length,
          isPrimary: false
        })
      );
    });
    cardsWithoutLocation.forEach((card) =>
      secondaryCandidates.push({
        card,
        index: primaryCandidates.length + secondaryCandidates.length,
        isPrimary: false
      })
    );

    const orderedCandidates = [...primaryCandidates, ...secondaryCandidates];

    if (orderedCandidates.length === 0) {
      return buildFallbackRoutes(routes);
    }

    const candidatesByRoute = new Map();
    orderedCandidates.forEach(({ card, index, isPrimary }) => {
      const routeKey = card.routeId ?? card.id;
      if (!routeKey) {
        return;
      }
      const routeEntries = candidatesByRoute.get(routeKey) ?? [];
      routeEntries.push({ card, index, isPrimary });
      candidatesByRoute.set(routeKey, routeEntries);
    });

    const finalCards = [];
    for (const [routeKey, entries] of candidatesByRoute.entries()) {
      const directionOptions = buildDirectionOptions(routeKey, entries, directionLookup);
      const desiredDirection = selectPreferredDirection(
        routeKey,
        directionOptions,
        entries,
        routeDirections
      );

      const chosen =
        entries.find((entry) => entry.card.directionId === desiredDirection) ??
        entries[0];

      const chosenCard = {
        ...chosen.card,
        selectedDirectionId: desiredDirection,
        directionOptions
      };

      const baseOrder = entries[0]?.index ?? 0;
      const isPrimary = entries.some((entry) => entry.isPrimary);
      finalCards.push({ card: chosenCard, order: baseOrder, isPrimary });
    }

    finalCards.sort((a, b) => a.order - b.order);

    const primaryCards = finalCards.filter((entry) => entry.isPrimary);
    const secondaryCards = finalCards.filter((entry) => !entry.isPrimary);

    if (primaryCards.length >= MAX_ROUTE_CARDS) {
      return primaryCards.slice(0, MAX_ROUTE_CARDS).map((entry) => entry.card);
    }

    return [...primaryCards, ...secondaryCards].slice(0, MAX_ROUTE_CARDS).map((entry) => entry.card);
  }, [routeDirections, routes, routesById, staleVehicles, stopsById, tripsById, userLocation, vehicles]);
}
